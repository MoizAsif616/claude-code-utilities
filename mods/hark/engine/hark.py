"""Speech-to-text engine for the `hark` mod.

Management commands run on any Python 3.9+ with the standard library alone:
  list | install <id> | remove <id> | prune <id> | discard <id> | use <id>
`serve` runs inside the mod's own environment (numpy, sounddevice and the
model's backend), records from the microphone and transcribes.

Every command writes JSON lines to stdout; logs go to stderr.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tarfile
import threading
import time
import urllib.request
from pathlib import Path, PurePosixPath

GH = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/"
HF = "https://huggingface.co/"

# One entry per model the mod can install. `size_mb` is the download.
# `languages` leads with the main one; `language_count` counts all, when more than are named.
CATALOG = [
    {
        "id": "moonshine-tiny",
        "name": "Moonshine Tiny",
        "backend": "sherpa",
        "kind": "moonshine2",
        "languages": ["English"],
        "size_mb": 30,
        "ram_mb": 150,
        "speed": "fastest",
        "accuracy": "fair",
        "source": GH + "sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27.tar.bz2",
        "note": "Smallest and quickest; fine for short, clear prompts",
    },
    {
        "id": "moonshine-base",
        "name": "Moonshine Base",
        "backend": "sherpa",
        "kind": "moonshine2",
        "languages": ["English"],
        "size_mb": 111,
        "ram_mb": 300,
        "speed": "very fast",
        "accuracy": "good",
        "source": GH + "sherpa-onnx-moonshine-base-en-quantized-2026-02-27.tar.bz2",
        "note": "Recommended: the best balance of speed, size and accuracy",
        "recommended": True,
    },
    {
        "id": "kroko-live",
        "name": "Kroko Live",
        "backend": "sherpa",
        "kind": "streaming",
        "languages": ["English"],
        "size_mb": 57,
        "ram_mb": 200,
        "speed": "real time",
        "accuracy": "fair",
        "source": GH + "sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06.tar.bz2",
        "note": "True streaming: words appear as you say them; no punctuation",
    },
    {
        "id": "parakeet-110m",
        "name": "Parakeet 110M",
        "backend": "sherpa",
        "kind": "nemo_transducer",
        "languages": ["English"],
        "size_mb": 108,
        "ram_mb": 400,
        "speed": "very fast",
        "accuracy": "very good",
        "source": GH + "sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8.tar.bz2",
        "note": "Very accurate for its size, with punctuation and capitals",
    },
    {
        "id": "parakeet-0.6b",
        "name": "Parakeet 0.6B v2",
        "backend": "sherpa",
        "kind": "nemo_transducer",
        "languages": ["English"],
        "size_mb": 482,
        "ram_mb": 1200,
        "speed": "fast",
        "accuracy": "excellent",
        "source": GH + "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2",
        "note": "Best English accuracy that is still fast on a CPU",
    },
    {
        "id": "parakeet-0.6b-multi",
        "name": "Parakeet 0.6B v3",
        "backend": "sherpa",
        "kind": "nemo_transducer",
        "languages": ["English"],
        "language_count": 25,
        "size_mb": 487,
        "ram_mb": 1200,
        "speed": "fast",
        "accuracy": "excellent",
        "source": GH + "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2",
        "note": "Parakeet for English, German, French, Spanish and 21 more",
    },
    {
        "id": "sensevoice",
        "name": "SenseVoice Small",
        "backend": "sherpa",
        "kind": "sense_voice",
        "languages": ["Chinese", "Cantonese", "English", "Japanese", "Korean"],
        "size_mb": 163,
        "ram_mb": 500,
        "speed": "very fast",
        "accuracy": "very good",
        "source": GH + "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2",
        "note": "Best pick for East Asian languages",
    },
    {
        "id": "whisper-small",
        "name": "Whisper Small",
        "backend": "whisper",
        "languages": ["English"],
        "language_count": 99,
        "size_mb": 484,
        "ram_mb": 1000,
        "speed": "medium",
        "accuracy": "good",
        "source": "Systran/faster-whisper-small",
        "note": "Multilingual all-rounder",
    },
    {
        "id": "whisper-distil-large-v3.5",
        "name": "Distil-Whisper Large",
        "backend": "whisper",
        "languages": ["English"],
        "language": "en",
        "size_mb": 1513,
        "ram_mb": 2500,
        "speed": "slow on CPU",
        "accuracy": "excellent",
        "source": "distil-whisper/distil-large-v3.5-ct2",
        "note": "Near large-model English accuracy at about 6x its speed",
    },
    {
        "id": "whisper-large-v3-turbo",
        "name": "Whisper Large v3 Turbo",
        "backend": "whisper",
        "languages": ["English"],
        "language_count": 99,
        "size_mb": 1618,
        "ram_mb": 2500,
        "speed": "slow on CPU",
        "accuracy": "excellent",
        "source": "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
        "note": "High-end multilingual; wants a strong CPU",
    },
    {
        "id": "whisper-large-v3",
        "name": "Whisper Large v3",
        "backend": "whisper",
        "languages": ["English"],
        "language_count": 99,
        "size_mb": 3087,
        "ram_mb": 5000,
        "speed": "very slow on CPU",
        "accuracy": "best",
        "source": "Systran/faster-whisper-large-v3",
        "note": "Highest accuracy; for powerful machines",
    },
]

# sherpa-onnx is a base package as well as a backend: it runs the speech detector for every model.
BASE_PACKAGES = ["numpy", "sounddevice", "sherpa-onnx>=1.13.8"]
BACKEND_PACKAGES = {
    "sherpa": ["sherpa-onnx>=1.13.8"],
    "whisper": ["faster-whisper>=1.1.0"],
}
BACKEND_MODULE = {"sherpa": "sherpa_onnx", "whisper": "faster_whisper"}

# Silero, the speech detector: tells speech from silence and noise, about 640 KB.
VAD_SOURCE = GH + "silero_vad.onnx"

SAMPLE_RATE = 16000
LOCK = threading.Lock()


def emit(event: str, **fields) -> None:
    with LOCK:
        sys.stdout.write(json.dumps({"event": event, **fields}) + "\n")
        sys.stdout.flush()


def log(text: str) -> None:
    sys.stderr.write(text.rstrip() + "\n")
    sys.stderr.flush()


class Fail(Exception):
    pass


# --- Paths and config -------------------------------------------------------


def home() -> Path:
    override = os.environ.get("HARK_HOME")
    return Path(override) if override else Path.home() / ".claude" / "hark"


def models_dir() -> Path:
    return home() / "models"


def venv_dir() -> Path:
    return home() / "venv"


def venv_python() -> Path:
    if os.name == "nt":
        return venv_dir() / "Scripts" / "python.exe"
    return venv_dir() / "bin" / "python"


def config_path() -> Path:
    return home() / "config.json"


def vad_path() -> Path:
    return home() / "silero_vad.onnx"


def read_config() -> dict:
    try:
        return json.loads(config_path().read_text())
    except (OSError, ValueError):
        return {}


def write_config(config: dict) -> None:
    home().mkdir(parents=True, exist_ok=True)
    config_path().write_text(json.dumps(config, indent=2))


def entry(model_id: str) -> dict:
    for one in CATALOG:
        if one["id"] == model_id:
            return one
    names = ", ".join(one["id"] for one in CATALOG)
    raise Fail(f"Unknown model '{model_id}'. Known models: {names}")


def is_installed(model_id: str) -> bool:
    return (models_dir() / model_id / "manifest.json").is_file()


def installed_ids() -> list:
    return [one["id"] for one in CATALOG if is_installed(one["id"])]


def active_id() -> str | None:
    active = read_config().get("active")
    if active and is_installed(active):
        return active
    installed = installed_ids()
    return installed[0] if installed else None


# --- Management commands -----------------------------------------------------


def cmd_list() -> None:
    models = [
        {**one, "installed": is_installed(one["id"])}
        for one in CATALOG
    ]
    emit(
        "list",
        models=models,
        active=active_id(),
        home=str(home()),
        venv_python=str(venv_python()),
        has_venv=venv_python().is_file(),
    )


def cmd_use(model_id: str) -> None:
    entry(model_id)
    if not is_installed(model_id):
        raise Fail(f"'{model_id}' is not installed. Install it from /hark-models first.")
    write_config({**read_config(), "active": model_id})
    emit("done", active=model_id)


def remove_model(model_id: str) -> None:
    shutil.rmtree(models_dir() / model_id)
    config = read_config()
    if config.get("active") == model_id:
        config.pop("active", None)
        write_config(config)


def drop_backends(backends: set) -> None:
    """Uninstalls the libraries of each of `backends` no installed model still uses."""
    used = {entry(one)["backend"] for one in installed_ids()}
    unused = [backend for backend in backends if backend not in used]
    packages = [p for backend in unused for p in BACKEND_PACKAGES[backend] if p not in BASE_PACKAGES]
    if packages and venv_python().is_file():
        pip(["uninstall", *[p.split(">")[0] for p in packages]], quiet=True)


def cmd_remove(model_id: str) -> None:
    model = entry(model_id)
    if not (models_dir() / model_id).exists():
        raise Fail(f"'{model_id}' is not installed.")
    remove_model(model_id)
    drop_backends({model["backend"]})
    emit("done", removed=model_id, active=active_id())


def cmd_discard(model_id: str) -> None:
    """Removes what a cancelled install left behind: the partial download, and
    the libraries it set up if no installed model uses them."""
    model = entry(model_id)
    partial = models_dir() / f".{model_id}.partial"
    if partial.exists():
        shutil.rmtree(partial)
    drop_backends({model["backend"]})
    emit("done", discarded=model_id)


def cmd_prune(keep_id: str) -> None:
    """Deletes every downloaded model but `keep_id`, so only the one in use takes disk space."""
    entry(keep_id)
    others = [one for one in installed_ids() if one != keep_id]
    for one in others:
        remove_model(one)
    drop_backends({entry(one)["backend"] for one in others})
    emit("done", pruned=others, freed_mb=sum(entry(one)["size_mb"] for one in others))


def cmd_install(model_id: str) -> None:
    model = entry(model_id)
    emit("step", text="Preparing the Python environment")
    ensure_venv()
    ensure_packages(model["backend"])
    if not vad_path().is_file():
        emit("step", text="Downloading the speech detector")
        ensure_vad()
    target = models_dir() / model_id
    if is_installed(model_id):
        emit("step", text="Already downloaded")
    else:
        partial = models_dir() / f".{model_id}.partial"
        if partial.exists():
            shutil.rmtree(partial)
        partial.mkdir(parents=True)
        emit("step", text=f"Downloading {model['name']}")
        if model["source"].startswith("https://"):
            download_archive(model["source"], partial)
        else:
            download_hf(model["source"], partial)
        (partial / "manifest.json").write_text(
            json.dumps({"id": model_id, "source": model["source"], "at": time.time()})
        )
        if target.exists():
            shutil.rmtree(target)
        partial.rename(target)
    write_config({**read_config(), "active": model_id})
    emit("done", installed=model_id, active=model_id)


# --- Environment -------------------------------------------------------------


def find_uv() -> str | None:
    found = shutil.which("uv")
    if found:
        return found
    for candidate in (Path.home() / ".local" / "bin" / "uv", Path.home() / ".cargo" / "bin" / "uv"):
        for path in (candidate, candidate.with_suffix(".exe")):
            if path.is_file():
                return str(path)
    return None


def run(argv: list, what: str) -> None:
    done = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if done.returncode != 0:
        tail = "\n".join(done.stdout.strip().splitlines()[-8:])
        raise Fail(f"{what} failed:\n{tail}")


def ensure_venv() -> None:
    if venv_python().is_file():
        return
    home().mkdir(parents=True, exist_ok=True)
    uv = find_uv()
    if uv:
        run([uv, "venv", "--quiet", "--python", sys.executable, str(venv_dir())], "Creating the environment with uv")
        return
    try:
        import ensurepip  # noqa: F401
    except ImportError:
        raise Fail(
            "Python cannot create virtual environments here. Install one of:\n"
            "  uv (https://docs.astral.sh/uv/), or\n"
            "  python3-venv (Debian/Ubuntu: sudo apt install python3-venv)"
        )
    run([sys.executable, "-m", "venv", str(venv_dir())], "Creating the environment")


def pip(args: list, quiet: bool = False) -> None:
    uv = find_uv()
    if uv:
        argv = [uv, "pip", *args, "--python", str(venv_python())]
    else:
        argv = [str(venv_python()), "-m", "pip", *args]
        if args[0] == "uninstall":
            argv.append("-y")
    try:
        run(argv, "pip " + args[0])
    except Fail:
        if not quiet:
            raise


def has_modules(modules: list) -> bool:
    probe = "import " + ", ".join(modules)
    done = subprocess.run([str(venv_python()), "-c", probe], capture_output=True)
    return done.returncode == 0


def ensure_packages(backend: str) -> None:
    modules = ["numpy", "sherpa_onnx", BACKEND_MODULE[backend]]
    if has_modules(modules) and has_modules(["sounddevice"]):
        return
    emit("step", text="Installing libraries (first time only)")
    packages = [*BASE_PACKAGES, *(p for p in BACKEND_PACKAGES[backend] if p not in BASE_PACKAGES)]
    pip(["install", "--quiet", *packages])


def ensure_vad(timeout: float = 60) -> None:
    """Downloads the speech detector once, next to the models."""
    if vad_path().is_file():
        return
    home().mkdir(parents=True, exist_ok=True)
    partial = vad_path().with_suffix(".partial")
    with http_open(VAD_SOURCE, timeout) as response, open(partial, "wb") as sink:
        shutil.copyfileobj(response, sink)
    partial.rename(vad_path())


# --- Downloads ---------------------------------------------------------------


def http_open(url: str, timeout: float = 60):
    request = urllib.request.Request(url, headers={"User-Agent": "claude-code-hark-mod"})
    return urllib.request.urlopen(request, timeout=timeout)


class Progress:
    def __init__(self, total: int):
        self.total = total
        self.done = 0
        self.shown_at = 0.0

    def add(self, count: int) -> None:
        self.done += count
        now = time.time()
        if now - self.shown_at >= 0.25:
            self.shown_at = now
            emit("progress", done=self.done, total=self.total)


class CountingReader:
    def __init__(self, raw, progress: Progress):
        self.raw = raw
        self.progress = progress

    def read(self, size: int = -1) -> bytes:
        chunk = self.raw.read(size)
        self.progress.add(len(chunk))
        return chunk


def download_archive(url: str, dest: Path) -> None:
    """Streams a .tar.bz2 and unpacks it into dest, dropping its top folder."""
    with http_open(url) as response:
        progress = Progress(int(response.headers.get("Content-Length") or 0))
        with tarfile.open(fileobj=CountingReader(response, progress), mode="r|bz2") as archive:
            for member in archive:
                if not member.isfile():
                    continue
                parts = PurePosixPath(member.name).parts[1:]
                if not parts or ".." in parts or PurePosixPath(member.name).is_absolute():
                    continue
                if "test_wavs" in parts or parts[-1] in ("README.md",):
                    continue
                out = dest.joinpath(*parts)
                out.parent.mkdir(parents=True, exist_ok=True)
                source = archive.extractfile(member)
                with open(out, "wb") as sink:
                    shutil.copyfileobj(source, sink, 1 << 20)
        emit("progress", done=progress.done, total=progress.total)


def download_hf(repo: str, dest: Path) -> None:
    with http_open(f"{HF}api/models/{repo}/tree/main") as response:
        tree = json.loads(response.read())
    files = [
        one for one in tree
        if one.get("type") == "file"
        and not one["path"].startswith(".")
        and one["path"] != "README.md"
    ]
    progress = Progress(sum(one.get("size", 0) for one in files))
    for one in files:
        with http_open(f"{HF}{repo}/resolve/main/{one['path']}") as response:
            with open(dest / one["path"], "wb") as sink:
                while True:
                    chunk = response.read(1 << 20)
                    if not chunk:
                        break
                    sink.write(chunk)
                    progress.add(len(chunk))
    emit("progress", done=progress.done, total=progress.total)


# --- Recognizers -------------------------------------------------------------


def pick(folder: Path, *patterns: str) -> str:
    """The first file matching a pattern, int8 builds preferred."""
    for pattern in patterns:
        found = sorted(folder.glob(pattern), key=lambda p: ("int8" not in p.name, len(p.name)))
        if found:
            return str(found[0])
    raise Fail(f"{folder.name}: no file matches {patterns}")


def threads() -> int:
    return max(1, min(4, (os.cpu_count() or 2) // 2))


class OfflineModel:
    is_streaming = False

    def __init__(self, model: dict, folder: Path):
        self.backend = model["backend"]
        if self.backend == "whisper":
            from faster_whisper import WhisperModel

            self.language = model.get("language")
            self.whisper = WhisperModel(str(folder), device="cpu", compute_type="int8", cpu_threads=threads())
            return
        import sherpa_onnx as so

        kind = model["kind"]
        tokens = pick(folder, "tokens.txt")
        if kind == "moonshine2":
            self.recognizer = so.OfflineRecognizer.from_moonshine_v2(
                encoder=pick(folder, "encoder_model*.ort", "encoder*.onnx"),
                decoder=pick(folder, "decoder_model_merged*.ort", "decoder*.onnx"),
                tokens=tokens,
                num_threads=threads(),
            )
        elif kind == "nemo_transducer":
            self.recognizer = so.OfflineRecognizer.from_transducer(
                encoder=pick(folder, "encoder*.onnx"),
                decoder=pick(folder, "decoder*.onnx"),
                joiner=pick(folder, "joiner*.onnx"),
                tokens=tokens,
                num_threads=threads(),
                model_type="nemo_transducer",
            )
        elif kind == "sense_voice":
            self.recognizer = so.OfflineRecognizer.from_sense_voice(
                model=pick(folder, "model*.onnx"),
                tokens=tokens,
                num_threads=threads(),
                use_itn=True,
            )
        else:
            raise Fail(f"unknown model kind {kind}")

    def decode(self, audio) -> str:
        if len(audio) < SAMPLE_RATE // 10:
            return ""
        if self.backend == "whisper":
            segments, _ = self.whisper.transcribe(
                audio,
                language=self.language,
                beam_size=1,
                condition_on_previous_text=False,
                without_timestamps=True,
                vad_filter=False,
            )
            return "".join(one.text for one in segments).strip()
        stream = self.recognizer.create_stream()
        stream.accept_waveform(SAMPLE_RATE, audio)
        self.recognizer.decode_stream(stream)
        return stream.result.text.strip()


class StreamingModel:
    is_streaming = True

    def __init__(self, model: dict, folder: Path):
        import sherpa_onnx as so

        self.recognizer = so.OnlineRecognizer.from_transducer(
            encoder=pick(folder, "encoder*.onnx"),
            decoder=pick(folder, "decoder*.onnx"),
            joiner=pick(folder, "joiner*.onnx"),
            tokens=pick(folder, "tokens.txt"),
            num_threads=min(2, threads()),
        )
        self.stream = None

    def begin(self) -> None:
        self.stream = self.recognizer.create_stream()

    def feed(self, audio) -> str:
        self.stream.accept_waveform(SAMPLE_RATE, audio)
        while self.recognizer.is_ready(self.stream):
            self.recognizer.decode_stream(self.stream)
        return self.recognizer.get_result(self.stream).strip()

    def finish(self) -> str:
        import numpy as np

        text = self.feed(np.zeros(int(SAMPLE_RATE * 0.8), dtype=np.float32))
        self.stream.input_finished()
        while self.recognizer.is_ready(self.stream):
            self.recognizer.decode_stream(self.stream)
        text = self.recognizer.get_result(self.stream).strip() or text
        self.stream = None
        return text.capitalize() if text.isupper() else text


def load_model(model_id: str):
    model = entry(model_id)
    folder = models_dir() / model_id
    if model.get("kind") == "streaming":
        return StreamingModel(model, folder)
    return OfflineModel(model, folder)


# --- Recording ---------------------------------------------------------------

FRAME = 512  # 32 ms at 16 kHz: the window the speech detector reads
SILENCE_TO_CUT = 0.45  # seconds of quiet that close a segment
MAX_SEGMENT = 24.0  # seconds; Whisper reads at most 30


def make_vad():
    """The Silero speech detector, or None: hark then goes by loudness alone."""
    try:
        ensure_vad(timeout=10)
        import sherpa_onnx as so

        config = so.VadModelConfig(
            silero_vad=so.SileroVadModelConfig(
                model=str(vad_path()), threshold=0.5, min_silence_duration=0.1,
                min_speech_duration=0.1, window_size=FRAME,
            ),
            sample_rate=SAMPLE_RATE,
        )
        return so.VoiceActivityDetector(config)
    except Exception as error:
        log(f"speech detector unavailable, going by loudness: {type(error).__name__}: {error}")
        return None


class Recorder:
    """Owns one recording: the microphone, the speech detector and decoding."""

    def __init__(self, model, vad=None):
        import numpy as np

        self.np = np
        self.model = model
        self.vad = vad
        self.lock = threading.Lock()
        self.chunks = []
        self.length = 0
        self.stream = None
        self.worker = None
        self.is_recording = False
        self.started_at = 0.0

    # The microphone ----------------------------------------------------------

    def open_mic(self) -> None:
        import sounddevice as sd

        np = self.np

        def take(block, rate):
            mono = block[:, 0].astype(np.float32)
            if rate != SAMPLE_RATE:
                count = int(len(mono) * SAMPLE_RATE / rate)
                mono = np.interp(
                    np.linspace(0, len(mono), count, endpoint=False),
                    np.arange(len(mono)),
                    mono,
                ).astype(np.float32)
            with self.lock:
                self.chunks.append(mono)
                self.length += len(mono)

        try:
            self.stream = sd.InputStream(
                samplerate=SAMPLE_RATE, channels=1, dtype="float32", blocksize=1600,
                callback=lambda block, *_: take(block, SAMPLE_RATE),
            )
        except Exception:
            rate = int(sd.query_devices(kind="input")["default_samplerate"])
            self.stream = sd.InputStream(
                samplerate=rate, channels=1, dtype="float32", blocksize=rate // 10,
                callback=lambda block, *_: take(block, rate),
            )
        self.stream.start()

    def close_mic(self) -> None:
        if self.stream is not None:
            self.stream.stop()
            self.stream.close()
            self.stream = None

    def audio(self):
        with self.lock:
            if len(self.chunks) > 1:
                self.chunks = [self.np.concatenate(self.chunks)]
            return self.chunks[0] if self.chunks else self.np.zeros(0, dtype=self.np.float32)

    # The session -------------------------------------------------------------

    def start(self) -> None:
        if self.is_recording:
            return
        self.chunks, self.length = [], 0
        self.rms = self.np.zeros(0, dtype=self.np.float32)
        self.speech = self.np.zeros(0, dtype=bool)
        self.noise = None
        if self.vad is not None:
            self.vad.reset()
        self.open_mic()
        self.is_recording = True
        self.started_at = time.time()
        loop = self.loop_streaming if self.model.is_streaming else self.loop_offline
        self.worker = threading.Thread(target=loop, daemon=True)
        self.worker.start()

    def stop(self, discard: bool = False) -> dict:
        if not self.is_recording:
            return {"text": "", "ms": 0}
        stopped_at = time.time()
        self.close_mic()
        self.is_recording = False
        self.worker.join()
        text = "" if discard else self.final()
        return {"text": text, "ms": int((time.time() - stopped_at) * 1000), "seconds": round(stopped_at - self.started_at, 1)}

    # Streaming models: feed the audio as it comes ----------------------------

    def loop_streaming(self) -> None:
        self.model.begin()
        fed = 0
        shown = ""
        while self.is_recording:
            time.sleep(0.08)
            audio = self.audio()
            if len(audio) > fed:
                text = self.model.feed(audio[fed:])
                self.measure(audio)
                self.level(audio[fed:])
                fed = len(audio)
                if text != shown:
                    shown = text
                    emit("partial", text=text)
        self.fed = fed

    # Offline models: decode finished phrases, re-read the one in progress -----

    def loop_offline(self) -> None:
        self.committed = []
        self.cut = 0
        last_partial_at = 0.0
        partial_cost = 0.3
        partial_upto = 0
        shown = ""

        def show(text: str) -> None:
            nonlocal shown
            if text != shown:
                shown = text
                emit("partial", text=text)

        while self.is_recording:
            time.sleep(0.05)
            audio = self.audio()
            self.measure(audio)
            self.level(audio[-1600:])
            cut = self.find_cut(len(audio))
            if cut is not None:
                text = self.decode(audio[self.cut:cut], self.cut, cut)
                if text:
                    self.committed.append(text)
                self.cut = cut
                show(" ".join(self.committed))
                continue
            wait = max(0.5, partial_cost * 2)
            fresh = len(audio) - partial_upto > SAMPLE_RATE * 0.3
            if fresh and time.time() - last_partial_at >= wait:
                began = time.time()
                tail = self.decode(audio[self.cut:], self.cut, len(audio))
                partial_cost = time.time() - began
                last_partial_at = time.time()
                partial_upto = len(audio)
                if tail or self.committed:
                    show(" ".join([*self.committed, tail]).strip())

    def measure(self, audio) -> None:
        """Extends the per-frame loudness, the running noise floor and, with the
        detector, which frames are speech."""
        np = self.np
        known = len(self.rms) * FRAME
        whole = (len(audio) - known) // FRAME
        if whole <= 0:
            return
        frames = audio[known:known + whole * FRAME].reshape(whole, FRAME)
        rms = np.sqrt((frames ** 2).mean(axis=1))
        # The floor follows quiet frames only, so a long phrase does not lift it.
        for value in rms:
            value = float(value)
            if self.noise is None or value < self.noise:
                self.noise = value
            elif value < self.noise * 3:
                self.noise = self.noise * 0.98 + value * 0.02
            else:
                self.noise *= 1.0005
        self.rms = np.concatenate([self.rms, rms])
        if self.vad is not None:
            flags = np.zeros(whole, dtype=bool)
            for index, frame in enumerate(frames):
                self.vad.accept_waveform(frame)
                flags[index] = self.vad.is_speech_detected()
                # hark cuts phrases itself; the detector's own segments are not needed.
                while not self.vad.empty():
                    self.vad.pop()
            self.speech = np.concatenate([self.speech, flags])

    def speech_threshold(self) -> float:
        return max(0.006, (self.noise or 0.0) * 3)

    def speech_flags(self, first: int, last: int | None = None):
        """Which frames from `first` hold speech: the detector's call, else loudness over the floor."""
        if self.vad is not None:
            return self.speech[first:last]
        return self.rms[first:last] > self.speech_threshold()

    def find_cut(self, length: int):
        """Where the phrase in progress ended: the middle of a long enough pause."""
        first = self.cut // FRAME
        rms = self.rms[first:]
        if len(rms) == 0:
            return None
        is_speech = self.speech_flags(first)
        need = int(SILENCE_TO_CUT * SAMPLE_RATE / FRAME)
        quiet_run = 0
        heard = False
        for index, speech in enumerate(is_speech):
            if speech:
                if heard and quiet_run >= need:
                    return (first + index - quiet_run // 2) * FRAME
                heard = True
                quiet_run = 0
            else:
                quiet_run += 1
        if heard and quiet_run >= need * 2:
            return (first + len(rms) - quiet_run // 2) * FRAME
        if (length - self.cut) / SAMPLE_RATE > MAX_SEGMENT:
            window = rms[-int(4 * SAMPLE_RATE / FRAME):]
            quietest = len(rms) - len(window) + int(window.argmin())
            return (first + quietest) * FRAME
        return None

    def has_speech(self, start: int, end: int) -> bool:
        first, last = start // FRAME, max(start // FRAME + 1, end // FRAME)
        if self.vad is not None:
            return bool(self.speech[first:last].any())
        frames = self.rms[first:last]
        return len(frames) > 0 and float(frames.max()) > max(0.004, (self.noise or 0.0) * 2)

    def decode(self, audio, start: int, end: int) -> str:
        """Decodes audio[start:end] trimmed to its speech plus a margin: long
        stretches of quiet cost time, but a little lead-in keeps the first
        word whole and its capital (0.7 s tested best on Parakeet)."""
        if not self.has_speech(start, end):
            return ""
        loud = self.np.nonzero(self.speech_flags(start // FRAME, end // FRAME))[0]
        if len(loud) == 0:
            return self.model.decode(audio)
        head = max(0, int(loud[0]) * FRAME - int(0.7 * SAMPLE_RATE))
        tail = min(len(audio), (int(loud[-1]) + 1) * FRAME + int(0.35 * SAMPLE_RATE))
        return self.model.decode(audio[head:tail])

    def final(self) -> str:
        if self.model.is_streaming:
            audio = self.audio()
            if len(audio) > getattr(self, "fed", 0):
                self.model.feed(audio[self.fed:])
            return self.model.finish()
        audio = self.audio()
        self.measure(audio)
        tail = self.decode(audio[self.cut:], self.cut, len(audio))
        return " ".join([*self.committed, tail]).strip()

    def level(self, audio) -> None:
        now = time.time()
        if len(audio) == 0 or now - getattr(self, "level_at", 0.0) < 0.1:
            return
        self.level_at = now
        # Flat while nobody speaks: room noise and mic hiss do not move the bars.
        is_speaking = bool(self.speech_flags(max(0, len(self.rms) - 3)).any())
        rms = float(self.np.sqrt((audio[-1600:] ** 2).mean())) if is_speaking else 0.0
        emit("level", rms=round(rms, 4), seconds=round(time.time() - self.started_at, 1))


# --- The server --------------------------------------------------------------


def cmd_serve(model_id: str) -> None:
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    try:
        import numpy  # noqa: F401
        import sounddevice  # noqa: F401
    except OSError:
        raise Fail(
            "The PortAudio library is missing, so the microphone cannot be opened. Install it:\n"
            "  Debian/Ubuntu: sudo apt install libportaudio2\n"
            "  Fedora: sudo dnf install portaudio\n"
            "  Arch: sudo pacman -S portaudio"
        )
    parent = os.getppid()
    busy = threading.Lock()
    loaded = {}  # "recorder", once the model has loaded

    def quit_soon() -> None:
        # The model may still be loading in native code, which cannot be
        # interrupted, so leave at once rather than wait for it.
        time.sleep(0.05)
        os._exit(0)

    def watch_parent() -> None:
        """Leaves once Claude Code is gone, so no engine outlives its session."""
        while True:
            time.sleep(2)
            if os.getppid() != parent:
                os._exit(0)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, body: dict, status: int = 200) -> None:
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            recorder = loaded.get("recorder")
            self.reply({"model": model_id, "loaded": recorder is not None, "recording": bool(recorder and recorder.is_recording)})

        def do_POST(self):
            length = int(self.headers.get("Content-Length") or 0)
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
            except ValueError:
                body = {}
            recorder = loaded.get("recorder")
            try:
                with busy:
                    if self.path == "/quit":
                        if recorder is not None:
                            recorder.stop(discard=True)
                        self.reply({"quit": True})
                        threading.Thread(target=quit_soon, daemon=True).start()
                    elif recorder is None:
                        self.reply({"error": "the model is still loading"}, 503)
                    elif self.path == "/start":
                        recorder.start()
                        self.reply({"recording": True})
                    elif self.path == "/stop":
                        self.reply(recorder.stop())
                    elif self.path == "/cancel":
                        recorder.stop(discard=True)
                        self.reply({"cancelled": True})
                    else:
                        self.reply({"error": "unknown path"}, 404)
            except Exception as error:  # the microphone, mostly
                if recorder is not None:
                    recorder.is_recording = False
                    recorder.close_mic()
                self.reply({"error": f"{type(error).__name__}: {error}"}, 500)

    # The server answers from the start, so /quit stops an engine still loading.
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    threading.Thread(target=watch_parent, daemon=True).start()
    emit("listening", port=port)
    began = time.time()
    model = load_model(model_id)
    if not model.is_streaming:
        model.decode(__import__("numpy").zeros(SAMPLE_RATE, dtype="float32"))  # warm-up
    loaded["recorder"] = Recorder(model, make_vad())
    emit("ready", port=port, model=model_id, name=entry(model_id)["name"], load_ms=int((time.time() - began) * 1000))
    threading.Event().wait()


def main() -> None:
    args = sys.argv[1:]
    try:
        if not args or args[0] == "list":
            cmd_list()
        elif args[0] == "install" and len(args) == 2:
            cmd_install(args[1])
        elif args[0] == "remove" and len(args) == 2:
            cmd_remove(args[1])
        elif args[0] == "prune" and len(args) == 2:
            cmd_prune(args[1])
        elif args[0] == "discard" and len(args) == 2:
            cmd_discard(args[1])
        elif args[0] == "use" and len(args) == 2:
            cmd_use(args[1])
        elif args[0] == "serve" and len(args) == 2:
            cmd_serve(args[1])
        else:
            raise Fail("usage: hark.py list | install <id> | remove <id> | prune <id> | discard <id> | use <id> | serve <id>")
    except Fail as error:
        emit("error", text=str(error))
        sys.exit(1)
    except Exception as error:
        emit("error", text=f"{type(error).__name__}: {error}")
        raise


if __name__ == "__main__":
    main()
