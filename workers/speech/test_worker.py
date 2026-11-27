import tempfile
import unittest
import wave
from pathlib import Path
from worker import build_parser, read_audio


class AudioTests(unittest.TestCase):
    def test_pcm_and_reject_stereo(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'audio.wav'
            for channels in (1, 2):
                with wave.open(str(path), 'wb') as f:
                    f.setparams((channels, 2, 16000, 0, 'NONE', 'not compressed'))
                    f.writeframes(b'\x00\x40' * channels * 160)
                if channels == 1:
                    samples = read_audio(path)
                    self.assertEqual(len(samples), 160)
                    self.assertAlmostEqual(float(samples[0]), 0.5)
                else:
                    with self.assertRaises(ValueError):
                        read_audio(path)

    def test_empty_audio_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'empty.wav'
            with wave.open(str(path), 'wb') as f:
                f.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            with self.assertRaises(ValueError):
                read_audio(path)

    def test_context_and_accuracy_arguments(self):
        args = build_parser().parse_args([
            "--audio", "meeting.wav", "--initial-prompt", "Participants: Shubham",
            "--hotwords", "Shubham, model", "--beam-size", "5"
        ])
        self.assertEqual(args.initial_prompt, "Participants: Shubham")
        self.assertEqual(args.hotwords, "Shubham, model")
        self.assertEqual(args.beam_size, 5)

    def test_native_stdout_does_not_corrupt_protocol(self):
        import subprocess
        import sys
        script = "from worker import model_output_to_stderr; import os\nwith model_output_to_stderr():\n print('python log')\n os.write(1, b'native log\\n')\nprint('{}')"
        result = subprocess.run([sys.executable, '-c', script], cwd=Path(__file__).parent, capture_output=True, text=True, check=True)
        self.assertEqual(result.stdout.strip(), '{}')
        self.assertIn('native log', result.stderr)
        self.assertIn('python log', result.stderr)
