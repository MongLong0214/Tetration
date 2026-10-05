"""Measure the original maximum scene with and without preceding native GPU work.

This opt-in diagnostic preserves the 640x430 viewport, 16384 limit, AA16 and
240-second render deadline. It does not replace the production qualification.
"""
from pathlib import Path
import subprocess
import sys
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tests'))
import browser_common as bc

suite = bc.Suite('cpu-recovery', ['Diagnostic comparison, not full production qualification.'])
PROGRESS = '''setInterval(()=>{const d=window.tetraDiagnostics;if(!d)return;
 console.info('CPU_PROGRESS',JSON.stringify({mode:d.mode,workers:d.workers,complete:d.complete,
 stage:d.renderStage,progress:document.querySelector('#loadingText')?.textContent,
 failure:d.gpuFailure,time:performance.now()}));},10000);'''


def body():
    with sync_playwright() as p:
        for engine in ['cpu', 'auto']:
            browser = bc.launch(p)
            suite.report['browser_version'] = browser.version
            context = browser.new_context(viewport={'width': 640, 'height': 430})
            context.add_init_script(PROGRESS)
            page = suite.watch(context.new_page())
            def log(message):
                if not message.text.startswith('CPU_PROGRESS'):
                    return
                print(engine, message.text, flush=True)
                process = subprocess.run(['ps', '-Ao', 'pid,pcpu,comm'], capture_output=True, text=True, check=True)
                print('BROWSER_CPU', '\n'.join(line for line in process.stdout.splitlines() if 'Chrom' in line), flush=True)
            page.on('console', log)
            print('CPU_RECOVERY_STAGE', engine, flush=True)
            page.goto(bc.BASE + '/#v=1&x=-1.84&y=0.09&s=0.46&n=16384&q=16&e=' + engine)
            bc.ready(page)
            d = bc.state(page)
            assert d['iterations'] == 16384 and d['lastCompleted']['samples'] == 16 and d['complete'], d
            assert d['lastCompleted']['width'] == 640 and d['lastCompleted']['height'] == 354, d
            suite.record(engine + ' completes the unchanged maximum scene', d['lastCompleted'])
            context.close()
            browser.close()
        suite.no_errors()


bc.run(suite, body)
