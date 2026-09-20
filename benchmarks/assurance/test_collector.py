import importlib.util
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location('collector', Path(__file__).with_name('collect-quixbugs.py'))
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)

class JunitClassification(unittest.TestCase):
    def test_timeout_is_not_an_assertion_failure(self):
        case = ET.fromstring('<testcase><failure message="Failed: Timeout (&gt;2.0s) from pytest-timeout." /></testcase>')
        self.assertEqual(collector.case_outcome(case), 'timeout')
        case.find('failure').set('message', 'assert 4 == 5')
        self.assertEqual(collector.case_outcome(case), 'failed')

    def test_error_skip_and_pass_remain_distinct(self):
        for element, expected in [('<error />', 'error'), ('<skipped />', 'skipped'), ('', 'passed')]:
            self.assertEqual(collector.case_outcome(ET.fromstring('<testcase>' + element + '</testcase>')), expected)

if __name__ == '__main__':
    unittest.main()
