import urllib.request
import json

try:
    req = urllib.request.Request(
        "https://data-asg.goldprice.org/db/g60",
        headers={"User-Agent": "Mozilla/5.0"}
    )
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode('utf-8'))
        print(json.dumps(data, indent=2))
except Exception as e:
    print("Error:", e)
