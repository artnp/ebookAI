#!/usr/bin/env python3
import sys, os, tempfile, subprocess, shutil

def check_dependencies():
    try:
        import ebooklib
        import reportlab
        from PIL import Image
    except ImportError as e:
        print(f"Missing dependency: {e.name}")
        print("Install with: pip install ebooklib reportlab Pillow")
        sys.exit(1)

def convert_epub_to_pdf(epub_path, pdf_path=None):
    from ebooklib import epub
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    import html

    if pdf_path is None:
        pdf_path = os.path.splitext(epub_path)[0] + '.pdf'

    book = epub.read_epub(epub_path)
    doc = SimpleDocTemplate(pdf_path, pagesize=A4,
                            leftMargin=20*mm, rightMargin=20*mm,
                            topMargin=20*mm, bottomMargin=20*mm)
    styles = getSampleStyleSheet()
    story = []

    for item in book.get_items():
        if item.get_type() == 9:
            content = item.get_body_content().decode('utf-8', errors='replace')
            text = content.replace('\n', ' ').replace('\r', '')
            import re
            text = re.sub(r'<[^>]+>', '', text)
            text = html.unescape(text).strip()
            if text:
                para = Paragraph(text, styles['Normal'])
                story.append(para)
                story.append(Spacer(1, 6*mm))

    doc.build(story)
    print(f"Converted: {epub_path} -> {pdf_path}")
    return pdf_path

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python convertepub2pdf.py <input.epub> [output.pdf]")
        sys.exit(1)
    check_dependencies()
    epub_path = sys.argv[1]
    pdf_path = sys.argv[2] if len(sys.argv) > 2 else None
    if not os.path.exists(epub_path):
        print(f"File not found: {epub_path}")
        sys.exit(1)
    convert_epub_to_pdf(epub_path, pdf_path)
