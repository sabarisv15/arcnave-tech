# Test fixture: a packaged skill script. It sees `input_data` and writes to OUTPUT_PATH.
import json


def parse_number(text):
    return float(str(text).replace(',', ''))


json.dump({'pages': len(input_data.get('pages', []))}, open(OUTPUT_PATH, 'w'))
