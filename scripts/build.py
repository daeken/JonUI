#!/usr/bin/env python3
"""Build the pinned shared Node library and the native JonUI launcher."""
import hashlib
import os
import platform
import plistlib
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
VERSION = "24.22.2"
SHA256 = "8fe2ec1723bb9f8d0b683907c82708debbeda64af21cb2aa214c4241eed0a061"
CACHE = ROOT / ".build/node"
SOURCE = CACHE / f"node-v{VERSION}"
OUTPUT = ROOT / ".build/jonui"
SWIFT_TARGET = f"{platform.machine()}-apple-macosx14.0"


def run(args, cwd=ROOT, **kwargs):
    subprocess.run([str(a) for a in args], cwd=cwd, check=True, **kwargs)


def main():
    if sys.platform != "darwin":
        raise SystemExit("JonUI currently requires macOS 14+ and Xcode's Swift toolchain")
    CACHE.mkdir(parents=True, exist_ok=True)
    archive = CACHE / "source.tar.xz"
    if not SOURCE.exists():
        if not archive.exists():
            print(f"Downloading Node {VERSION} source…", flush=True)
            urllib.request.urlretrieve(f"https://nodejs.org/dist/v{VERSION}/node-v{VERSION}.tar.xz", archive)
        if hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256:
            raise SystemExit(f"Node source checksum mismatch; remove {archive} and retry")
        with tarfile.open(archive) as package:
            package.extractall(CACHE, filter="data")
    if not (SOURCE / "out/Release/build.ninja").exists():
        run(["./configure", "--shared", "--without-node-snapshot", "--without-node-code-cache", "--ninja"], cwd=SOURCE)
    print("Building shared Node (first build takes several minutes)…", flush=True)
    run(["ninja", "-C", "out/Release", "-j", os.environ.get("JONUI_BUILD_JOBS", "6"), "node"], cwd=SOURCE)
    lib = next(p for p in (SOURCE / "out/Release").glob("libnode.*.dylib") if not p.is_symlink())
    (OUTPUT / "lib").mkdir(parents=True, exist_ok=True)
    target = OUTPUT / "lib" / lib.name
    if not target.exists() or target.stat().st_mtime < lib.stat().st_mtime:
        shutil.copy2(lib, target)
        run(["install_name_tool", "-id", f"@rpath/{lib.name}", target])
        run(["codesign", "--force", "--sign", "-", target])
    cpp = OUTPUT / "NodeRuntime.o"
    swift = OUTPUT / "Host.o"
    header = ROOT / "native/include/jonui.h"
    if not cpp.exists() or cpp.stat().st_mtime < max((ROOT / "native/NodeRuntime.cpp").stat().st_mtime, header.stat().st_mtime, Path(__file__).stat().st_mtime):
        run(["clang++", "-std=c++20", "-mmacosx-version-min=14.0", "-O2", "-stdlib=libc++", "-Inative/include", f"-I{SOURCE}/src", f"-I{SOURCE}/deps/v8/include", f"-I{SOURCE}/deps/uv/include", "-c", "native/NodeRuntime.cpp", "-o", cpp])
    if not swift.exists() or swift.stat().st_mtime < max((ROOT / "native/Host.swift").stat().st_mtime, header.stat().st_mtime, Path(__file__).stat().st_mtime):
        run(["swiftc", "-target", SWIFT_TARGET, "-parse-as-library", "-swift-version", "5", "-O", "-import-objc-header", header, "-emit-object", "native/Host.swift", "-o", swift])
    binary = OUTPUT / "jonui"
    if not binary.exists() or binary.stat().st_mtime < max(cpp.stat().st_mtime, swift.stat().st_mtime, target.stat().st_mtime):
        run(["swiftc", "-target", SWIFT_TARGET, swift, cpp, target, "-lc++", "-framework", "AppKit", "-framework", "SwiftUI", "-framework", "WebKit", "-Xlinker", "-rpath", "-Xlinker", "@executable_path/lib", "-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks", "-o", binary])
        run(["codesign", "--force", "--sign", "-", binary])
    # A development app identity makes windows discoverable to native accessibility
    # tools. The command-line wrapper still supplies the application's entry file.
    bundle = OUTPUT / "JonUI.app/Contents"
    (bundle / "MacOS").mkdir(parents=True, exist_ok=True)
    (bundle / "Frameworks").mkdir(exist_ok=True)
    bundled_binary = bundle / "MacOS/jonui"
    if not bundled_binary.exists() or bundled_binary.stat().st_mtime < binary.stat().st_mtime:
        pending_binary = bundled_binary.with_suffix(".tmp")
        shutil.copy2(binary, pending_binary)
        os.replace(pending_binary, bundled_binary)
    bundled_lib = bundle / "Frameworks" / lib.name
    if not bundled_lib.exists() or not bundled_lib.samefile(target):
        bundled_lib.unlink(missing_ok=True)
        os.link(target, bundled_lib)
    info = {"CFBundleName": "JonUI", "CFBundleDisplayName": "JonUI",
            "CFBundleIdentifier": "dev.jonui.launcher", "CFBundleExecutable": "jonui",
            "CFBundlePackageType": "APPL", "CFBundleVersion": "1",
            "CFBundleShortVersionString": "0.0.0", "LSMinimumSystemVersion": "14.0",
            "NSHighResolutionCapable": True, "NSPrincipalClass": "NSApplication"}
    (bundle / "Info.plist").write_bytes(plistlib.dumps(info))
    print(f"Built {bundled_binary}", flush=True)


if __name__ == "__main__":
    main()
