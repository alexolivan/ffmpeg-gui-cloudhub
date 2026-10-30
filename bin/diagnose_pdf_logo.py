#!/usr/bin/env python3
"""Diagnostic utility to inspect PDF logo resolution, storage, PIL and SVG rasterization."""

import os
import sys

# Ensure project root is in sys.path
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

def main():
    print("=" * 65)
    print("      FFMPEG-GUI CLOUDHUB - PDF LOGO DIAGNOSTIC SUITE        ")
    print("=" * 65)

    # 1. Inspect SystemSettings in SQLite
    print("\n[1] Checking SystemSettings in Database...")
    try:
        from backend.database.db import SessionLocal
        from backend.database.models import SystemSettings, Organization
        with SessionLocal() as db:
            disk_rec = db.query(SystemSettings).filter(SystemSettings.key == "login_logo_disk_path").first()
            url_rec = db.query(SystemSettings).filter(SystemSettings.key == "login_logo_url").first()
            text_rec = db.query(SystemSettings).filter(SystemSettings.key == "login_logo_text").first()

            disk_path = disk_rec.value if disk_rec else None
            url_val = url_rec.value if url_rec else None
            text_val = text_rec.value if text_rec else None

            print(f"  • login_logo_disk_path : {disk_path}")
            print(f"  • login_logo_url       : {url_val}")
            print(f"  • login_logo_text      : {text_val}")

            orgs = db.query(Organization).all()
            print(f"  • Total Organizations  : {len(orgs)}")
            for o in orgs:
                icon_type = "None"
                if o.icon_data:
                    icon_type = "DataURI" if o.icon_data.startswith("data:") else f"Text({o.icon_data[:10]})"
                print(f"    - Org '{o.name}' (id={o.id}, slug={o.slug}): icon_data={icon_type}")
    except Exception as e:
        print(f"  [ERROR] Database access failed: {e}")
        return

    # 2. Inspect File on Disk
    print("\n[2] Checking Logo File on Disk...")
    upload_dir = os.environ.get("CLOUDHUB_UPLOAD_DIR", "data/uploads")
    print(f"  • UPLOAD_DIR: {upload_dir} (exists={os.path.isdir(upload_dir)})")
    if os.path.isdir(upload_dir):
        files = os.listdir(upload_dir)
        print(f"  • Files in UPLOAD_DIR ({len(files)}): {files}")

    resolved_file = None
    if disk_path:
        raw_val = disk_path.strip().strip('"').strip("'")
        candidates = [raw_val, os.path.abspath(raw_val), os.path.join(upload_dir, os.path.basename(raw_val))]
        for c in candidates:
            if c and os.path.isfile(c):
                resolved_file = c
                break

    if resolved_file:
        sz = os.path.getsize(resolved_file)
        with open(resolved_file, "rb") as f:
            head = f.read(150)
        print(f"  • Found file: {resolved_file}")
        print(f"  • Size: {sz} bytes")
        print(f"  • Header preview: {head[:60]}")
        is_svg = b"<svg" in head.lower() or b"<?xml" in head.lower()
        is_png = head.startswith(b"\x89PNG")
        print(f"  • Detected Type: {'SVG' if is_svg else ('PNG' if is_png else 'Other')}")
    else:
        print("  • [WARNING] No file found for login_logo_disk_path!")

    # 3. Check FFmpeg / rsvg-convert (Optional, only needed if uploading .svg vector logos)
    print("\n[3] Checking SVG Rasterizers (Optional, only needed for .svg logos)...")
    import subprocess
    import shutil
    rsvg_cmd = shutil.which("rsvg-convert")
    ffmpeg_cmd = shutil.which("ffmpeg")

    if rsvg_cmd:
        print(f"  • rsvg-convert : Available at {rsvg_cmd} (Fast SVG conversion supported)")
    else:
        print("  • rsvg-convert : Not installed")

    if ffmpeg_cmd:
        try:
            res = subprocess.run([ffmpeg_cmd, "-version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
            if res.returncode == 0:
                out_txt = res.stdout.decode("utf-8", errors="replace")
                has_librsvg = "--enable-librsvg" in out_txt
                first_line = out_txt.splitlines()[0] if out_txt.splitlines() else "OK"
                print(f"  • ffmpeg binary : Available ({first_line})")
                print(f"  • --enable-librsvg : {'YES (Native SVG conversion supported)' if has_librsvg else 'NO (Missing librsvg!)'}")
            else:
                print(f"  • ffmpeg exited with code {res.returncode}")
        except Exception as e:
            print(f"  • ffmpeg check failed: {e}")
    else:
        print("  • ffmpeg binary : Not installed (Not required for PNG/JPEG logos)")

    # 4. Check PIL / Pillow (REQUIRED for PDF logo embedding)
    print("\n[4] Checking PIL (Pillow - REQUIRED for PDF logo embedding)...")
    try:
        import PIL
        from PIL import Image
        print(f"  • Pillow version: {PIL.__version__} (INSTALLED)")
        if resolved_file:
            with open(resolved_file, "rb") as f:
                b = f.read()
            try:
                import io
                im = Image.open(io.BytesIO(b))
                print(f"  • Direct PIL load: SUCCESS (format={im.format}, size={im.size}, mode={im.mode})")
            except Exception as e:
                print(f"  • Direct PIL load: FAILED ({e})")
    except ImportError:
        print("  • [ERROR] Pillow is NOT installed in virtual environment!")
        print("    Run: ./venv/bin/pip install Pillow")
    except Exception as e:
        print(f"  • [ERROR] PIL check failed: {e}")

    # 5. Execute _resolve_pdf_logo_bytes & _prepare_pdf_logo
    print("\n[5] Testing PDF Logo Pipeline...")
    try:
        from backend.routers.settings_routes import _resolve_pdf_logo_bytes
        from backend.services.audit_pdf_generator import _prepare_pdf_logo
        with SessionLocal() as db:
            raw_bytes = _resolve_pdf_logo_bytes(db)
            print(f"  • _resolve_pdf_logo_bytes: {len(raw_bytes) if raw_bytes else 0} bytes returned")

            logo_data = _prepare_pdf_logo(raw_bytes)
            if logo_data:
                print(f"  • _prepare_pdf_logo: SUCCESS! (w={logo_data['w_px']}, h={logo_data['h_px']}, length={logo_data['length']})")
                print("\n>>> RESULT: PDF LOGO PIPELINE IS WORKING NATIVELY! <<<")
            else:
                print("  • _prepare_pdf_logo: FAILED (returned None - PDF will fall back to monogram text box)")
                print("\n>>> RESULT: PDF LOGO CANNOT BE EMBEDDED. Review reasons above. <<<")
    except Exception as e:
        import traceback
        print(f"  • [ERROR] Pipeline test crashed: {e}")
        traceback.print_exc()

    print("=" * 65)

if __name__ == "__main__":
    main()
