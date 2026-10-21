"""scripts/ on sys.path, so the tests import eval.py the way prewarm.py and runtimes.py do. eval.py
imports boto3 only inside main, so nothing here needs AWS."""
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
