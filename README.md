# SentientStudy

A **desktop application** that monitors engagement, confusion, and frustration during study sessions using webcam facial tracking (ResNet-18 → LSTM), screen OCR, and audio transcription (Whisper).

## Core Highlights

- **NLP Auto-Titling:** Automatically identify the specific study topic to replace raw text dumps in graph tooltips.
- **Dark Glassmorphic Theme:** A modernized, sleek dashboard UI with uniform navigation.
- **Interactive Friction Context Modals:** Clickable friction points dynamically pop up detailed OCR and Audio transcription context for precision analysis.
- **Inline Session Lifetime Management:** Seamlessly delete tracking sessions immediately within the application interface via SPA design.

## Setup

1. **Activate the virtual environment**:
   ```powershell
   .\.venv\Scripts\activate
   ```

2. **Install dependencies**:
   ```powershell
   pip install -r requirements.txt
   ```

   *Note: System screen reading is managed via Python-native `easyocr`. No external executable installations are required.*

3. **Pull required Ollama models** (for the Session Assistant):
   ```powershell
   ollama pull llama3.2:1b
   ollama pull nomic-embed-text
   ```

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
│   ├── nlp_utils.py         # NLP Auto-titling & context processing
│   ├── query_engine.py      # Local LLM inference (RAG pipeline)
│   ├── embedding_utils.py   # Vector embedding + cosine similarity
│   └── ml_models.py         # ResNet-18 extractor + LSTM classifiers
├── frontend/
│   ├── dashboard.html       # Primary session metrics view
│   ├── details.html         # Individual session overview & friction graphs
│   ├── scripts/
│   │   ├── api.js           # API connectivity & JSON handling
│   │   ├── charts.js        # Chart.js visualization + tooltips
│   │   └── ui.js            # Modals, buttons, and interaction flow
│   └── styles/
│       └── main.css         # Dark glassmorphic styling
├── models/                  # Pre-trained LSTM weights (.pth)
├── data/                    # SQLite DB + temp recordings + embeddings
└── requirements.txt         # Segmented Python dependencies
```
