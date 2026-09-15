import urllib.request
import re
import json

try:
    req = urllib.request.Request(
        "https://html.duckduckgo.com/html/?q=current+gold+rate+in+india",
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    )
    with urllib.request.urlopen(req) as response:
        html = response.read().decode('utf-8')
    
    # Extract snippets from DDG HTML
    snippets = re.findall(r'<a class="result__snippet"[^>]*>(.*?)</a>', html, re.DOTALL)
    for s in snippets[:4]:
        # remove html tags
        clean = re.sub(r'<[^>]+>', '', s).strip()
        print(clean)
except Exception as e:
    print("Error:", e)
