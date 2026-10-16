# -*- coding: utf-8 -*-
"""Chrome Web Store 发布工具（Light or Night）。

用法::

    python tools/release.py status     # 查条目当前状态（只读）
    python tools/release.py build      # 只打 zip
    python tools/release.py upload     # 打 zip + 上传为草稿（不进审核）
    python tools/release.py release    # 打 zip + 上传 + 提交审核

凭据（二选一）:

1. 环境变量 ``CHROME_SERVICE_ACCOUNT_JSON`` —— 服务账号 JSON 的**路径**，
   或者直接放 JSON **内容**（以 ``{`` 开头时按内容处理）。
2. 命令行 ``--key <路径>``。

条目 ID 默认取环境变量 ``CHROME_EXTENSION_ID``，没有则用下面的常量。
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import requests
from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "manifest.json"

ITEM_ID = "cenalkpapgjdnhiogepkmigbfngepkaj"
SCOPE = ["https://www.googleapis.com/auth/chromewebstore"]
API = "https://www.googleapis.com/chromewebstore/v1.1/items"
UPLOAD_API = "https://www.googleapis.com/upload/chromewebstore/v1.1/items"
HDR = {"x-goog-api-version": "2"}


# --------------------------------------------------------------------------- #
# 凭据
# --------------------------------------------------------------------------- #
def load_session(key_arg: str | None) -> AuthorizedSession:
    raw = key_arg or os.environ.get("CHROME_SERVICE_ACCOUNT_JSON", "").strip()
    if not raw:
        sys.exit(
            "找不到凭据。请设置环境变量 CHROME_SERVICE_ACCOUNT_JSON（服务账号 JSON 的路径），"
            "或用 --key <路径> 指定。"
        )

    if raw.lstrip().startswith("{"):
        info = json.loads(raw)
    else:
        path = Path(raw)
        if not path.is_file():
            sys.exit(f"凭据文件不存在：{path}")
        info = json.loads(path.read_text(encoding="utf-8"))

    creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPE)
    session = AuthorizedSession(creds)          # 自动刷新，长时间运行也不会掉线
    print(f"✓ 凭据      {creds.service_account_email}")
    return session


def item_id() -> str:
    return os.environ.get("CHROME_EXTENSION_ID", "").strip() or ITEM_ID


# --------------------------------------------------------------------------- #
# 打包
# --------------------------------------------------------------------------- #
def manifest_version() -> str:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))["version"]


def _bash() -> str:
    """定位 Git Bash。不走 PATH 兜底到 WSL 的 bash。"""
    for cand in (r"C:\Program Files\Git\usr\bin\bash.exe",
                 r"C:\Program Files\Git\bin\bash.exe",
                 shutil.which("bash")):
        if cand and Path(cand).is_file():
            return cand
    sys.exit("找不到 Git Bash —— build.sh 需要它。")


def build() -> Path:
    """调用 build.sh 打包（保持单一事实来源）。

    注意：脚本名必须用**相对路径**并配合 cwd=ROOT。传绝对 Windows 路径给
    Git Bash 时，反斜杠会被当转义，bash 找不到文件而返回 127。
    """
    if not (ROOT / "build.sh").is_file():
        sys.exit(f"找不到 {ROOT / 'build.sh'}")
    print("» 打包中（build.sh）...")
    proc = subprocess.run([_bash(), "build.sh"], cwd=ROOT, capture_output=True)
    out = proc.stdout.decode("utf-8", "replace")
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", "replace")
        sys.exit(f"打包失败（exit {proc.returncode}）\n{out}\n{err}")

    version = manifest_version()
    zip_path = ROOT / f"light-or-night-v{version}.zip"
    if not zip_path.is_file():
        sys.exit(f"打包脚本跑完了，但没找到预期的包：{zip_path}")

    print(f"✓ 打包      {zip_path.name}  ({zip_path.stat().st_size / 1024:.0f} KB, v{version})")
    return zip_path


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #
def status(session: AuthorizedSession) -> dict:
    r = session.get(f"{API}/{item_id()}", headers=HDR, params={"projection": "DRAFT"}, timeout=60)
    r.raise_for_status()
    return r.json()


def upload(session: AuthorizedSession, zip_path: Path) -> dict:
    print(f"» 上传 {zip_path.name} ...")
    with zip_path.open("rb") as fh:
        r = session.put(
            f"{UPLOAD_API}/{item_id()}",
            headers={**HDR, "Content-Type": "application/zip"},
            data=fh,
            timeout=300,
        )
    if r.status_code != 200:
        sys.exit(f"上传失败 [{r.status_code}] {r.text[:600]}")
    data = r.json()

    state = data.get("uploadState")
    print(f"✓ 上传      uploadState={state}  crxVersion={data.get('crxVersion')}")
    errors = data.get("itemError") or []
    if errors:
        for e in errors:
            print(f"  ✗ [{e.get('error_code')}] {e.get('error_detail')}")
    if state != "SUCCESS":
        sys.exit("上传状态不是 SUCCESS，中止。")
    return data


def publish(session: AuthorizedSession, target: str) -> None:
    params = {} if target == "default" else {"publishTarget": target}
    print(f"» 提交审核（target={target}）...")
    r = session.post(f"{API}/{item_id()}/publish", headers={**HDR, "Content-Length": "0"},
                     params=params, timeout=120)
    if r.status_code != 200:
        sys.exit(f"提交失败 [{r.status_code}] {r.text[:600]}")
    data = r.json()
    print(f"✓ 已提交    状态={data.get('status')}")
    for s in data.get("statusDetail") or []:
        print(f"  · {s}")
    for e in data.get("itemError") or []:
        print(f"  ✗ [{e.get('error_code')}] {e.get('error_detail')}")


# --------------------------------------------------------------------------- #
# 命令
# --------------------------------------------------------------------------- #
def cmd_status(args, session):
    data = status(session)
    print(json.dumps({k: data.get(k) for k in
                      ("id", "crxVersion", "uploadState", "publishedItemRevisionStatus")},
                     ensure_ascii=False, indent=2))
    for e in data.get("itemError") or []:
        print(f"  ✗ [{e.get('error_code')}] {e.get('error_detail')}")


def cmd_build(args, session):
    build()


def cmd_upload(args, session):
    if not args.no_version_check:
        remote = status(session).get("crxVersion")
        local = manifest_version()
        if remote == local:
            sys.exit(f"远端已经是 v{local}，manifest 版本号没动过。"
                     f"先改 manifest.json 的 version（或用 --no-version-check 跳过）。")
        print(f"✓ 版本      {remote} → {local}")
    upload(session, build())


def cmd_release(args, session):
    cmd_upload(args, session)
    publish(session, args.target)
    print("\n完成。可在开发者信息中心查看审核进度。")


def main() -> None:
    ap = argparse.ArgumentParser(description="Chrome Web Store 发布工具")
    ap.add_argument("--key", help="服务账号 JSON 路径（覆盖环境变量）")
    ap.add_argument("--target", default="default", choices=["default", "trustedTesters"],
                    help="发布目标，默认对公众发布")
    ap.add_argument("--no-version-check", action="store_true",
                    help="跳过“远端版本 == 本地版本”的拦截")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name, fn, help_ in (("status", cmd_status, "查条目状态（只读）"),
                            ("build", cmd_build, "只打 zip"),
                            ("upload", cmd_upload, "打 zip + 上传为草稿"),
                            ("release", cmd_release, "打 zip + 上传 + 提交审核")):
        p = sub.add_parser(name, help=help_)
        p.set_defaults(func=fn)

    args = ap.parse_args()
    session = load_session(args.key)
    args.func(args, session)


if __name__ == "__main__":
    main()
