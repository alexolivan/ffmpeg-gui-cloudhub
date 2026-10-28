"""Pure-Python professional PDF report generator for CloudHub Audit Logs.

Generates standard PDF 1.4 documents with zero third-party dependencies.
Includes executive summary, filtering metadata, paginated tabular audit events,
alternating row styling, and dynamic page numbering.
"""

import datetime
import html
import re
import zlib
from typing import Any, Dict, List, Optional


def _escape_pdf_str(text: Any) -> str:
    """Escapes string characters for PDF text operators."""
    if text is None:
        return ""
    s = str(text)
    # Replace non-ascii or non-latin1 characters with safe equivalents
    s = s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    out = []
    for ch in s:
        code = ord(ch)
        if 32 <= code <= 126:
            out.append(ch)
        elif code == 10:
            out.append(" ")
        elif 160 <= code <= 255:
            out.append(ch)
        else:
            out.append("?")
    return "".join(out)


class PDFCanvas:
    """Low-level PDF content stream builder for a single page."""

    def __init__(self, width: float = 595.28, height: float = 841.89):
        self.width = width
        self.height = height
        self.commands: List[str] = []

    def set_fill_color(self, r: float, g: float, b: float) -> None:
        self.commands.append(f"{r:.3f} {g:.3f} {b:.3f} rg")

    def set_stroke_color(self, r: float, g: float, b: float) -> None:
        self.commands.append(f"{r:.3f} {g:.3f} {b:.3f} RG")

    def set_line_width(self, width: float) -> None:
        self.commands.append(f"{width:.2f} w")

    def draw_rect(self, x: float, y: float, w: float, h: float, fill: bool = True, stroke: bool = False) -> None:
        op = "B" if (fill and stroke) else ("f" if fill else "s")
        self.commands.append(f"{x:.2f} {y:.2f} {w:.2f} {h:.2f} re {op}")

    def draw_line(self, x1: float, y1: float, x2: float, y2: float) -> None:
        self.commands.append(f"{x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l s")

    def draw_text(
        self,
        text: str,
        x: float,
        y: float,
        font: str = "/F1",
        size: float = 9.0,
        r: float = 0.0,
        g: float = 0.0,
        b: float = 0.0,
    ) -> None:
        escaped = _escape_pdf_str(text)
        self.commands.append(f"q {r:.3f} {g:.3f} {b:.3f} rg BT {font} {size:.1f} Tf {x:.2f} {y:.2f} Td ({escaped}) Tj ET Q")

    def get_stream(self) -> bytes:
        raw = "\n".join(self.commands).encode("latin1")
        return zlib.compress(raw)


class AuditPdfReportGenerator:
    """Generates paginated corporate audit reports in PDF format."""

    PAGE_WIDTH = 595.28  # A4 Portrait
    PAGE_HEIGHT = 841.89
    MARGIN_LEFT = 36.0
    MARGIN_RIGHT = 36.0
    CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT

    def __init__(self, logs: List[Dict[str, Any]], metadata: Optional[Dict[str, Any]] = None):
        self.logs = logs
        self.metadata = metadata or {}
        self.pages: List[PDFCanvas] = []

    def build_pdf(self) -> bytes:
        """Constructs and returns binary PDF bytes."""
        # 1. Prepare metrics
        total_events = len(self.logs)
        unique_users = len(set(l.get("username", "") for l in self.logs if l.get("username")))
        unique_nodes = len(set(l.get("node_id", "") for l in self.logs if l.get("node_id")))
        security_events = sum(
            1 for l in self.logs if any(k in (l.get("action") or "").upper() for k in ["LOGIN", "FAIL", "AUTH", "PASSWORD", "LOCKOUT"])
        )

        now_str = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        app_version = self.metadata.get("app_version", "1.5.0")
        tenant_name = self.metadata.get("tenant_name", "All Tenants")
        date_range = self.metadata.get("date_range", "All Recorded Events")
        node_filter = self.metadata.get("node_name", "All Appliances")

        # 2. Layout rows across pages
        # Page 1 has banner + metadata + KPI cards: holds ~23 table rows
        # Subsequent pages hold ~36 table rows
        ROWS_FIRST_PAGE = 22
        ROWS_SUBSEQUENT = 34

        log_chunks: List[List[Dict[str, Any]]] = []
        if not self.logs:
            log_chunks = [[]]
        else:
            first_chunk = self.logs[:ROWS_FIRST_PAGE]
            log_chunks.append(first_chunk)
            remaining = self.logs[ROWS_FIRST_PAGE:]
            while remaining:
                chunk = remaining[:ROWS_SUBSEQUENT]
                log_chunks.append(chunk)
                remaining = remaining[ROWS_SUBSEQUENT:]

        total_pages = len(log_chunks)

        for page_idx, chunk in enumerate(log_chunks, 1):
            canvas = PDFCanvas(self.PAGE_WIDTH, self.PAGE_HEIGHT)
            self._render_page_header(canvas, now_str, app_version, page_idx, total_pages)

            y = 755.0
            if page_idx == 1:
                # Render Metadata Block & KPI Cards on Page 1
                y = self._render_page1_metadata_and_kpis(
                    canvas, tenant_name, date_range, node_filter, total_events, security_events, unique_users, unique_nodes
                )

            # Render Audit Table Header
            y = self._render_table_header(canvas, y)

            # Render Rows in this chunk
            for row_idx, log in enumerate(chunk):
                y = self._render_table_row(canvas, y, log, row_idx)

            # Render Page Footer
            self._render_page_footer(canvas, page_idx, total_pages)
            self.pages.append(canvas)

        return self._assemble_pdf_file()

    def _render_page_header(self, c: PDFCanvas, now_str: str, version: str, page_num: int, total_pages: int) -> None:
        """Top banner on every page."""
        # Top brand bar
        c.set_fill_color(0.08, 0.10, 0.13)  # Dark slate
        c.draw_rect(self.MARGIN_LEFT, 775.0, self.CONTENT_WIDTH, 42.0, fill=True, stroke=False)

        # Accent lime indicator line
        c.set_fill_color(0.68, 0.95, 0.22)  # Brand lime
        c.draw_rect(self.MARGIN_LEFT, 772.0, self.CONTENT_WIDTH, 3.0, fill=True, stroke=False)

        # Brand title & subtitle
        c.draw_text("FFMPEG-GUI CLOUDHUB", self.MARGIN_LEFT + 12.0, 798.0, font="/F2", size=13.0, r=0.95, g=0.98, b=1.0)
        c.draw_text("AUDIT TRAIL & OPERATIONAL COMPLIANCE REPORT", self.MARGIN_LEFT + 12.0, 784.0, font="/F1", size=8.0, r=0.68, g=0.95, b=0.22)

        # Right header: timestamp & page info
        c.draw_text(f"Generated: {now_str}", self.PAGE_WIDTH - self.MARGIN_RIGHT - 180.0, 798.0, font="/F1", size=7.5, r=0.75, g=0.78, b=0.82)
        c.draw_text(f"Control Plane v{version} | Page {page_num} of {total_pages}", self.PAGE_WIDTH - self.MARGIN_RIGHT - 180.0, 784.0, font="/F2", size=8.0, r=0.90, g=0.92, b=0.95)

    def _render_page1_metadata_and_kpis(
        self,
        c: PDFCanvas,
        tenant_name: str,
        date_range: str,
        node_filter: str,
        total: int,
        sec: int,
        users: int,
        nodes: int,
    ) -> float:
        """Renders the top summary box and 4 KPI metrics on page 1."""
        # Scope & Filter Box
        c.set_fill_color(0.96, 0.97, 0.98)
        c.set_stroke_color(0.85, 0.88, 0.91)
        c.set_line_width(0.8)
        c.draw_rect(self.MARGIN_LEFT, 698.0, self.CONTENT_WIDTH, 56.0, fill=True, stroke=True)

        c.draw_text("REPORT FILTER SCOPE & AUDIT BOUNDARIES", self.MARGIN_LEFT + 10.0, 740.0, font="/F2", size=7.5, r=0.35, g=0.40, b=0.45)

        # Column 1
        c.draw_text(f"Target Tenant Organization:  {tenant_name}", self.MARGIN_LEFT + 10.0, 725.0, font="/F1", size=8.0, r=0.15, g=0.18, b=0.22)
        c.draw_text(f"Date Range Interval:        {date_range}", self.MARGIN_LEFT + 10.0, 710.0, font="/F1", size=8.0, r=0.15, g=0.18, b=0.22)

        # Column 2
        c.draw_text(f"Appliance Node Filter:      {node_filter}", self.MARGIN_LEFT + 280.0, 725.0, font="/F1", size=8.0, r=0.15, g=0.18, b=0.22)
        c.draw_text(f"Compliance Integrity:       Strict Tamper-Evident SHA-256", self.MARGIN_LEFT + 280.0, 710.0, font="/F1", size=8.0, r=0.15, g=0.18, b=0.22)

        # KPI Cards (4 cards)
        card_w = (self.CONTENT_WIDTH - 18.0) / 4.0
        y_kpi = 648.0
        h_kpi = 38.0

        kpi_defs = [
            ("TOTAL EVENTS", str(total), (0.12, 0.45, 0.85)),
            ("SECURITY & AUTH", str(sec), (0.85, 0.25, 0.20)),
            ("ACTIVE OPERATORS", str(users), (0.20, 0.65, 0.35)),
            ("LINKED APPLIANCES", str(nodes), (0.50, 0.30, 0.80)),
        ]

        for i, (label, val, col) in enumerate(kpi_defs):
            x = self.MARGIN_LEFT + i * (card_w + 6.0)
            c.set_fill_color(0.98, 0.98, 0.99)
            c.set_stroke_color(0.85, 0.88, 0.91)
            c.set_line_width(0.7)
            c.draw_rect(x, y_kpi, card_w, h_kpi, fill=True, stroke=True)

            c.draw_text(label, x + 6.0, y_kpi + 26.0, font="/F2", size=6.5, r=0.45, g=0.48, b=0.52)
            c.draw_text(val, x + 6.0, y_kpi + 9.0, font="/F2", size=13.0, r=col[0], g=col[1], b=col[2])

        return 634.0

    def _render_table_header(self, c: PDFCanvas, y: float) -> float:
        """Draws the dark audit table column header."""
        header_h = 16.0
        c.set_fill_color(0.12, 0.15, 0.18)
        c.draw_rect(self.MARGIN_LEFT, y - header_h, self.CONTENT_WIDTH, header_h, fill=True, stroke=False)

        # Columns:
        # Timestamp (92pt) | Channel (45pt) | Operator (65pt) | IP (75pt) | Action (95pt) | Target & Details (151pt)
        x = self.MARGIN_LEFT + 5.0
        c.draw_text("TIMESTAMP (UTC)", x, y - 11.0, font="/F2", size=7.0, r=0.90, g=0.92, b=0.95)
        x += 92.0
        c.draw_text("ORIGIN", x, y - 11.0, font="/F2", size=7.0, r=0.90, g=0.92, b=0.95)
        x += 45.0
        c.draw_text("OPERATOR", x, y - 11.0, font="/F2", size=7.0, r=0.90, g=0.92, b=0.95)
        x += 65.0
        c.draw_text("CLIENT IP", x, y - 11.0, font="/F2", size=7.0, r=0.90, g=0.92, b=0.95)
        x += 75.0
        c.draw_text("ACTION EVENT", x, y - 11.0, font="/F2", size=7.0, r=0.90, g=0.92, b=0.95)
        x += 95.0
        c.draw_text("TARGET & DETAILS", x, y - 11.0, font="/F2", size=7.0, r=0.90, g=0.92, b=0.95)

        return y - header_h

    def _render_table_row(self, c: PDFCanvas, y: float, log: Dict[str, Any], idx: int) -> float:
        """Draws a single audit log row with subtle zebra striping."""
        row_h = 13.5

        # Zebra striping
        if idx % 2 == 1:
            c.set_fill_color(0.965, 0.970, 0.975)
            c.draw_rect(self.MARGIN_LEFT, y - row_h, self.CONTENT_WIDTH, row_h, fill=True, stroke=False)

        # Subtle bottom line
        c.set_stroke_color(0.90, 0.91, 0.92)
        c.set_line_width(0.3)
        c.draw_line(self.MARGIN_LEFT, y - row_h, self.MARGIN_LEFT + self.CONTENT_WIDTH, y - row_h)

        # Format values
        ts = (log.get("timestamp") or "")[:19].replace("T", " ")
        ch = (log.get("channel") or "hub")[:6].upper()
        user = (log.get("username") or "system")[:12]
        ip = (log.get("ip_address") or "—")[:15]
        act = (log.get("action") or "EVENT")[:18]

        # Target and details
        target_info = f"[{log.get('target_type') or 'sys'}:{log.get('target_id') or '—'}]" if log.get("target_type") else ""
        details = (log.get("details") or "").replace("\n", " ").strip()
        combined_details = f"{target_info} {details}".strip()[:38]

        # Action color styling
        act_r, act_g, act_b = 0.20, 0.22, 0.25
        act_upper = act.upper()
        if any(w in act_upper for w in ["FAIL", "DELETE", "STOP", "LOCKOUT", "REVOKE"]):
            act_r, act_g, act_b = 0.80, 0.15, 0.15
        elif any(w in act_upper for w in ["SUCCESS", "CREATE", "START", "ENROLL"]):
            act_r, act_g, act_b = 0.15, 0.55, 0.20
        elif any(w in act_upper for w in ["UPDATE", "RESTART", "RENEW"]):
            act_r, act_g, act_b = 0.75, 0.45, 0.10

        x = self.MARGIN_LEFT + 5.0
        c.draw_text(ts, x, y - 9.5, font="/F1", size=6.8, r=0.25, g=0.28, b=0.32)
        x += 92.0
        c.draw_text(ch, x, y - 9.5, font="/F2", size=6.2, r=0.40, g=0.45, b=0.50)
        x += 45.0
        c.draw_text(user, x, y - 9.5, font="/F2", size=6.8, r=0.15, g=0.18, b=0.22)
        x += 65.0
        c.draw_text(ip, x, y - 9.5, font="/F1", size=6.5, r=0.35, g=0.38, b=0.42)
        x += 75.0
        c.draw_text(act, x, y - 9.5, font="/F2", size=6.5, r=act_r, g=act_g, b=act_b)
        x += 95.0
        c.draw_text(combined_details, x, y - 9.5, font="/F1", size=6.5, r=0.25, g=0.28, b=0.32)

        return y - row_h

    def _render_page_footer(self, c: PDFCanvas, page_num: int, total_pages: int) -> None:
        """Bottom footer notice on every page."""
        y = 28.0
        c.set_stroke_color(0.85, 0.88, 0.91)
        c.set_line_width(0.5)
        c.draw_line(self.MARGIN_LEFT, y + 10.0, self.MARGIN_LEFT + self.CONTENT_WIDTH, y + 10.0)

        c.draw_text(
            "CONFIDENTIAL DOCUMENT - STRICTLY FOR AUTHORIZED AUDIT, REGULATORY COMPLIANCE, AND SECURITY INVESTIGATION.",
            self.MARGIN_LEFT,
            y,
            font="/F1",
            size=6.2,
            r=0.50,
            g=0.55,
            b=0.60,
        )
        c.draw_text(
            f"Page {page_num} of {total_pages}",
            self.PAGE_WIDTH - self.MARGIN_RIGHT - 65.0,
            y,
            font="/F2",
            size=7.0,
            r=0.25,
            g=0.28,
            b=0.32,
        )

    def _assemble_pdf_file(self) -> bytes:
        """Packages pages and objects into compliant PDF 1.4 byte stream."""
        objects: List[Any] = []

        def add_obj(val: Any) -> int:
            objects.append(val)
            return len(objects)

        # 1. Catalog (Obj 1)
        # 2. Pages (Obj 2)
        # 3. Fonts: F1 (Helvetica), F2 (Helvetica-Bold) (Obj 3, Obj 4)
        catalog_idx = add_obj("<< /Type /Catalog /Pages 2 0 R >>")
        pages_placeholder_idx = add_obj("")  # Will update Pages definition
        font_f1_idx = add_obj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
        font_f2_idx = add_obj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")

        page_obj_ids = []
        for p in self.pages:
            # Add content stream object
            stream_bytes = p.get_stream()
            stream_obj = (
                f"<< /Length {len(stream_bytes)} /Filter /FlateDecode >>\nstream\n".encode("latin1")
                + stream_bytes
                + b"\nendstream"
            )
            content_id = add_obj(stream_obj)

            # Add Page object
            page_dict = (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {self.PAGE_WIDTH:.2f} {self.PAGE_HEIGHT:.2f}] "
                f"/Contents {content_id} 0 R /Resources << /Font << /F1 {font_f1_idx} 0 R /F2 {font_f2_idx} 0 R >> >> >>"
            )
            page_id = add_obj(page_dict)
            page_obj_ids.append(f"{page_id} 0 R")

        # Update Pages object (Obj 2)
        kids_str = " ".join(page_obj_ids)
        objects[1] = f"<< /Type /Pages /Kids [{kids_str}] /Count {len(self.pages)} >>"

        # Build output binary stream
        out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets = []
        for i, obj in enumerate(objects, 1):
            offsets.append(len(out))
            if isinstance(obj, str):
                out.extend(f"{i} 0 obj\n{obj}\nendobj\n".encode("latin1"))
            elif isinstance(obj, bytes):
                out.extend(f"{i} 0 obj\n".encode("latin1"))
                out.extend(obj)
                out.extend(b"\nendobj\n")

        xref_offset = len(out)
        out.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("latin1"))
        for off in offsets:
            out.extend(f"{off:010d} 00000 n \n".encode("latin1"))

        trailer = (
            f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n"
        )
        out.extend(trailer.encode("latin1"))

        return bytes(out)
