"""
Capture Engine — Real-time 10-second chunk processing pipeline.
No files are saved to disk (no .avi, no .wav). Everything is processed in memory.
"""
import cv2
import threading
import time
import os
import concurrent.futures

# Prevent OpenMP crash when multiple libraries load libiomp5md.dll (e.g. PyTorch + EasyOCR/Numpy)
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

from datetime import datetime, timedelta

import numpy as np
import mss
from PIL import Image
import torch
import soundcard as sc

from nlp_utils import extract_smart_title, generate_context_description

from database import get_connection

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR = os.path.join(PROJECT_ROOT, "models")

class CaptureEngine:
    def __init__(self):
        self._recording = False
        self._session_id = None
        self._start_ts = None
        self._threads = []
        self.camera_index = 0
        self.cap = None

        # Create ThreadPoolExecutor for managed thread execution
        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=2)

        print("\n" + "="*50)
        print("[engine] Loading AI Models into memory...")
        print("         (This may take a minute if downloading)")
        print("="*50 + "\n")

        try:
            from ml_models import get_resnet_extractor, load_lstm_model, get_transforms, DEVICE
            import whisper
            import easyocr

            self.device = DEVICE
            self.resnet = get_resnet_extractor()
            self.transform = get_transforms()
            self.e_model = load_lstm_model(os.path.join(MODELS_DIR, "Engagement_lstm.pth"))
            self.c_model = load_lstm_model(os.path.join(MODELS_DIR, "Confusion_lstm.pth"))
            self.f_model = load_lstm_model(os.path.join(MODELS_DIR, "Frustration_lstm.pth"))

            print("[engine] Loading Whisper model...")
            self.whisper_model = whisper.load_model("tiny")

            print("[engine] Loading EasyOCR model...")
            self.ocr_reader = easyocr.Reader(['en'], gpu=torch.cuda.is_available())

            self._models_loaded = True
            print("\n[engine] ALL MODELS LOADED SUCCESSFULLY! Ready to record.\n")
        except Exception as e:
            print(f"\n[engine] Failed to load models: {e}\n")
            self._models_loaded = False

    def start(self, session_id):
        if not self._models_loaded:
            raise RuntimeError("Models failed to load. Please check terminal logs.")

        self._recording = True
        self._session_id = session_id
        self._start_ts = datetime.now()

        self.cap = cv2.VideoCapture(self.camera_index)
        if not self.cap.isOpened():
            self.cap = None
            raise RuntimeError("[capture] ERROR: no webcam")

        print(f"[capture] Recording started (session {session_id})")

        # Start the main chunk processor thread
        t = threading.Thread(target=self._run_chunk_loop, daemon=True)
        self._threads = [t]
        t.start()

    def stop(self, on_done_callback=None):
        print(f"[capture] Stopping session {self._session_id}")
        self._recording = False

        if self.cap is not None:
            self.cap.release()
            self.cap = None

        if self._threads:
            self._threads[0].join()

        # Gracefully shutdown the executor, waiting for all tasks to complete
        print(f"[capture] Waiting for all processing tasks to complete...")
        self.executor.shutdown(wait=True)
        print(f"[capture] Session {self._session_id} completely stopped.")

        # Re-initialize the executor for the next session
        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=2)

        if on_done_callback:
            on_done_callback()

    def _run_chunk_loop(self):
        sct = mss.mss()
        audio_sr = 16000

        default_spk = sc.default_speaker()
        lb = sc.get_microphone(default_spk.id, include_loopback=True)
        print(f"[capture] Using loopback device for system audio: {lb.name}")

        with lb.recorder(samplerate=audio_sr, channels=1) as mic:
            while self._recording:
                chunk_start = time.time()

                # --- 1. Audio Capture (10 seconds in a background thread) ---
                audio_buffer_container = []
                def record_audio():
                    # This blocks for exactly the number of frames requested
                    audio_buffer_container.append(mic.record(numframes=int(10 * audio_sr)))

                audio_thread = threading.Thread(target=record_audio)
                audio_thread.start()

                # --- 2. Video Capture (Continuous for 10 seconds) ---
                captured_frames = []
                while time.time() - chunk_start < 10.0 and self._recording:
                    if self.cap is None or not self.cap.isOpened():
                        break
                    ret, frame = self.cap.read()
                    if ret:
                        captured_frames.append(frame)
                    else:
                        time.sleep(0.01)

                audio_thread.join() # Wait for the audio to finish its 10 seconds

                # Sample exactly 10 frames from the continuous 10s video chunk
                frames = []
                if len(captured_frames) > 0:
                    indices = np.linspace(0, len(captured_frames) - 1, 10, dtype=int)
                    for idx in indices:
                        f = captured_frames[idx]
                        frames.append(self.transform(cv2.cvtColor(f, cv2.COLOR_BGR2RGB)))
                else:
                    for _ in range(10):
                        frames.append(torch.zeros(3, 224, 224))

                # --- 3. Screen Capture (1 screenshot) ---
                try:
                    raw = sct.grab(sct.monitors[1] if len(sct.monitors) > 1 else sct.monitors[0])
                    img = Image.frombytes("RGB", raw.size, raw.bgra, "raw", "BGRX")

                    # Apply ROI Cropping (remove top 50 and bottom 50 pixels)
                    width, height = img.size
                    if height > 100:
                        img = img.crop((0, 50, width, height - 50))
                except Exception:
                    img = None

                # --- 4. Process the Chunk ---
                audio_data = audio_buffer_container[0].flatten() if audio_buffer_container else np.zeros(int(10 * audio_sr), dtype='float32')

                if not self._recording:
                    break

                # Use ThreadPoolExecutor instead of raw threading.Thread
                self.executor.submit(self._process_chunk, self._session_id, chunk_start, frames, audio_data, img)

        if self.cap is not None:
            self.cap.release()
            self.cap = None

    def _process_chunk(self, session_id, chunk_start_time, frames, audio_data, screen_img):
        offset_seconds = int(chunk_start_time - self._start_ts.timestamp())
        ts = (self._start_ts + timedelta(seconds=offset_seconds)).isoformat()

        # 1. Video Inference
        es, cs_, fs = 0.0, 0.0, 0.0
        if len(frames) == 10:
            batch = torch.stack(frames).to(self.device)
            with torch.no_grad():
                feats = self.resnet(batch).squeeze().unsqueeze(0)
                es = torch.sigmoid(self.e_model(feats)).item()
                cs_ = torch.sigmoid(self.c_model(feats)).item()
                fs = torch.sigmoid(self.f_model(feats)).item()

        # 2. Audio Transcription
        aud_text = ""
        try:
            # Enforce English and prevent it from hallucinating random languages during silence
            result = self.whisper_model.transcribe(
                audio_data,
                language="en",
                condition_on_previous_text=False,
                no_speech_threshold=0.6
            )

            # Filter out segments that are likely just background noise
            valid_segs = [s["text"] for s in result.get("segments", []) if s.get("no_speech_prob", 0) < 0.6]
            aud_text = " ".join(valid_segs).strip()
        except Exception as e:
            print(f"[audio] whisper error: {e}")

        # 3. Screen OCR
        ocr_text = ""
        if screen_img is not None:
            try:
                results = self.ocr_reader.readtext(np.array(screen_img), detail=0)
                ocr_text = " ".join(results)[:500]
            except Exception as e:
                print(f"[ocr] error: {e}")

        # 4. Save to DB
        topic = extract_smart_title([ocr_text, aud_text])
        description = generate_context_description(ocr_text, aud_text)
        conn = None
        try:
            conn = get_connection()
            conn.execute(
                "INSERT INTO session_data (session_id,timestamp,engagement_score,confusion_score,frustration_score,screen_text,audio_text,topic,description) VALUES (?,?,?,?,?,?,?,?,?)",
                (session_id, ts, es, cs_, fs, ocr_text, aud_text, topic, description),
            )
            conn.commit()
            print(f"[chunk] Processed 10s chunk at offset {offset_seconds}s (OCR: {len(ocr_text)} chars, Audio: {len(aud_text)} chars)")
        except Exception as e:
            print(f"[db] error: {e}")
        finally:
            if conn:
                conn.close()

engine = CaptureEngine()
