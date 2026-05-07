"""
SentientStudy — ML Models
ResNet-18 feature extractor  +  LSTM classifiers for engagement / confusion / frustration.
"""

import os

import torch
import torch.nn as nn
import torchvision.models as models
import torchvision.transforms as transforms

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")


class StateLSTM(nn.Module):
    """Single-output LSTM classifier that runs on top of ResNet-18 features."""

    def __init__(self, input_size: int = 512, hidden_size: int = 64, num_layers: int = 1):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size, hidden_size, num_layers,
            batch_first=True, dropout=0.0,
        )
        self.fc1 = nn.Linear(hidden_size, 32)
        self.relu = nn.ReLU()
        self.dropout = nn.Dropout(0.5)
        self.fc2 = nn.Linear(32, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out, _ = self.lstm(x)
        last = out[:, -1, :]
        x = self.dropout(self.relu(self.fc1(last)))
        return self.fc2(x).squeeze(1)


def get_resnet_extractor() -> nn.Module:
    """Load ResNet-18 with the final FC layer removed (outputs 512-d vectors)."""
    weights = models.ResNet18_Weights.DEFAULT
    resnet = models.resnet18(weights=weights)
    # Remove the classification head — keep everything up to the avg-pool
    extractor = nn.Sequential(*list(resnet.children())[:-1])
    extractor.to(DEVICE).eval()
    return extractor


def load_lstm_model(model_path: str) -> StateLSTM:
    """Load a trained StateLSTM checkpoint."""
    model = StateLSTM(input_size=512, hidden_size=64, num_layers=1)
    if os.path.exists(model_path):
        model.load_state_dict(torch.load(model_path, map_location=DEVICE, weights_only=True))
    else:
        print(f"[ml] WARNING: {model_path} not found — using random weights")
    model.to(DEVICE).eval()
    return model


def get_transforms() -> transforms.Compose:
    """ImageNet-normalised transforms expected by ResNet-18."""
    return transforms.Compose([
        transforms.ToPILImage(),
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize(
            mean=[0.485, 0.456, 0.406],
            std=[0.229, 0.224, 0.225],
        ),
    ])
