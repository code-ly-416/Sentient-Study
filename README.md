# SentientStudy

A **desktop application** that monitors engagement, confusion, and frustration during study sessions using webcam facial tracking (ResNet-18 → LSTM), screen OCR, and audio transcription (Whisper).

## Features

- Real-time webcam recording with ML-based affective state scoring
- 10-second aggregated data blocks with Engagement / Confusion / Frustration scores
- Automatic OCR screen-context extraction via Tesseract
- Audio transcription via OpenAI Whisper
- Simple web dashboard to view session data

## Setup

1. **Activate the virtual environment**:
   ```powershell
   .\.venv\Scripts\activate
   ```

2. **Install dependencies**:
   ```powershell
   pip install -r requirements.txt
   ```

3. **Install Tesseract-OCR** (required for screen context):
   - Download from [Tesseract for Windows](https://github.com/UB-Mannheim/tesseract/wiki)
   - Ensure `tesseract.exe` is on your system PATH

4. **Run the application**:
   ```powershell
   cd backend
   python main.py
   ```

5. **Open in browser**:
   Navigate to `http://localhost:8000`

## Project Structure

```
sentient-project/
├── backend/
│   ├── main.py              # FastAPI server + static file serving
│   ├── capture_engine.py    # Video / audio / screen recording threads
│   ├── database.py          # SQLite schema & helpers
│   └── ml_models.py         # ResNet-18 extractor + LSTM classifiers
├── frontend/
│   └── index.html           # Minimal test UI
├── models/                  # Pre-trained LSTM weights (.pth)
├── data/                    # SQLite DB + temp recordings
└── requirements.txt         # Python dependencies
```
