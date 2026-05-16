"""
SentientStudy — NLP utilities for session titling.
"""

import re
from collections import Counter


STOP_WORDS = {
    "the", "and", "with", "from", "that", "this", "have", "your", "for",
    "not", "are", "was", "but", "you", "has", "had", "use", "using", "about",
    "into", "they", "them", "their", "there", "here", "when", "where", "what",
    "will", "would", "could", "should", "been", "than", "then", "over", "more",
    "also", "can", "cant", "cannot", "just", "like", "some", "such", "each",
    "how", "why", "who", "whose", "while", "were", "which", "onto", "upon",
    "into", "out", "off", "on", "in", "at", "by", "an", "a", "to", "of",
    "is", "it", "as", "or", "be", "we", "he", "she", "they", "them", "our",
    "us", "your", "my", "mine", "yours", "ours", "its", "their",
}

UI_NOISE = {
    "chrome", "file", "edit", "view", "history", "bookmarks", "tabs", "tab",
    "window", "help", "search", "address", "settings", "extensions", "reload",
    "new", "private", "incognito", "back", "forward", "home",
}


def extract_smart_title(text_list: list[str]) -> str:
    """Return a concise 1–3 word title from OCR/audio text."""
    combined = " ".join([text for text in text_list if text]).strip()
    if not combined:
        return "Untitled Session"

    tokens = re.findall(r"[A-Za-z][A-Za-z0-9_\-]{3,}", combined)
    if not tokens:
        return "Untitled Session"

    weighted = Counter()
    for token in tokens:
        cleaned = token.strip("-_ ").lower()
        if len(cleaned) <= 4:
            continue
        if cleaned in STOP_WORDS or cleaned in UI_NOISE:
            continue
        weight = 2 if token[0].isupper() else 1
        weighted[cleaned] += weight

    if not weighted:
        return "Untitled Session"

    top_terms = [term for term, _ in weighted.most_common(3)]
    title = " ".join([t.title() for t in top_terms])
    return title.strip() or "Untitled Session"


def extract_session_key_topic(topic_list: list[str]) -> str:
    """Extract the single most common keyword from pre-computed chunk topics."""
    combined = " ".join([text for text in topic_list if text]).strip()
    if not combined:
        return "N/A"

    tokens = re.findall(r"[a-zA-Z0-9]{4,}", combined)
    if not tokens:
        return "N/A"

    weighted = Counter()
    for token in tokens:
        cleaned = token.lower()
        if cleaned in STOP_WORDS or cleaned in UI_NOISE:
            continue
        weighted[cleaned] += 1

    if not weighted:
        return "N/A"

    top_term, _ = weighted.most_common(1)[0]
    return top_term.title()


def generate_context_description(ocr_text: str, audio_text: str) -> str:
    parts = []
    ocr_text = (ocr_text or "").strip()
    audio_text = (audio_text or "").strip()

    if ocr_text:
        tokens = re.findall(r"[A-Za-z][A-Za-z0-9_\-]{2,}", ocr_text)
        valid_tokens = []
        seen = set()
        for token in tokens:
            cleaned = token.strip("-_ ").lower()
            if cleaned not in STOP_WORDS and cleaned not in UI_NOISE:
                if cleaned not in seen:
                    seen.add(cleaned)
                    valid_tokens.append(token)
        valid_tokens = valid_tokens[:6]
        if valid_tokens:
            keywords = ", ".join(valid_tokens)
            parts.append(f"On-screen workspace activity centered heavily around: {keywords}.")

    if audio_text:
        aud = audio_text
        if len(aud) > 0:
            aud = aud[0].upper() + aud[1:]
        if not aud.endswith(('.', '!', '?')):
            aud += '.'
        parts.append(f'Spoken concept indicators transcribed: "{aud}"')

    if not parts:
        return 'No active telemetry logged during this interval.'
    return " ".join(parts)