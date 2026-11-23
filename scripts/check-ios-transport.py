"""Verify the generated plist or the signed IPA before upload."""
import plistlib
import re
import sys
import zipfile
from pathlib import Path

path = Path(sys.argv[1])
if path.suffix == '.ipa':
    with zipfile.ZipFile(path) as archive:
        entries = [n for n in archive.namelist() if re.fullmatch(r'Payload/[^/]+\.app/Info\.plist', n)]
        if len(entries) != 1:
            sys.exit('Expected exactly one main application plist in IPA')
        plist = plistlib.loads(archive.read(entries[0]))
else:
    plist = plistlib.loads(path.read_bytes())
ats = plist.get('NSAppTransportSecurity')
if not isinstance(ats, dict) or set(ats) != {'NSAllowsArbitraryLoads'} or ats['NSAllowsArbitraryLoads'] is not True:
    sys.exit(f'Unexpected main app ATS policy: {ats!r}')
print('Main app ATS verified: NSAllowsArbitraryLoads=true, no override keys')
