"""Create / update dashboard users (scrypt hashes) in a users.json file.

    python services/api/manage_users.py infra/runtime/secrets/users.json alice operator
"""
import getpass
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "app"))
from passwords import hash_password  # noqa: E402

ROLES = ("viewer", "operator")

if len(sys.argv) != 4 or sys.argv[3] not in ROLES:
    sys.exit(__doc__)
path, user, role = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
pw = getpass.getpass(f"password for {user}: ")
if len(pw) < 10:
    sys.exit("use at least 10 characters")
users = json.loads(path.read_text()) if path.exists() else {}
users[user] = {"role": role, "password": hash_password(pw)}
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(users, indent=2))
print(f"{user} ({role}) saved to {path}")
