#!/usr/bin/env python3
import sys, os, tempfile, shutil, re, io
from urllib.parse import urlparse

def check_dependencies():
    try:
        import ebooklib
        from reportlab.lib.pagesizes import A4
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image as RLImage
        from reportlab.lib.styles import getSampleStyleSheet
        from PIL import Image
        from bs4 import BeautifulSoup
    except ImportError as e:
        print(f"Missing dependency: {e.name}")
        print("Install with: pip install ebooklib reportlab Pillow beautifulsoup4")
        sys.exit(1)

def convert_epub_to_pdf(epub_path, pdf_path=None):
    from ebooklib import epub
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image as RLImage, KeepTogether
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm, cm
    from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
    from PIL import Image
    from bs4 import BeautifulSoup
    import html as html_module

    if pdf_path is None:
        pdf_path = os.path.splitext(epub_path)[0] + '.pdf'

    book = epub.read_epub(epub_path)
    doc = SimpleDocTemplate(pdf_path, pagesize=A4,
                            leftMargin=15*mm, rightMargin=15*mm,
                            topMargin=15*mm, bottomMargin=15*mm)
    styles = getSampleStyleSheet()
    normal_style = ParagraphStyle('CustomNormal', parent=styles['Normal'],
                                  fontSize=10, leading=14,
                                  spaceAfter=6, alignment=TA_JUSTIFY)
    heading_style = ParagraphStyle('CustomHeading', parent=styles['Heading1'],
                                   fontSize=16, leading=20,
                                   spaceAfter=10, spaceBefore=14,
                                   textColor='#1a1a1a')
    story = []

    # Extract images from the epub
    image_map = {}
    for item in book.get_items():
        if item.get_type() == epub.ITEM_IMAGE:
            name = item.get_name()
            data = item.get_content()
            image_map[name] = data
            # Also store by basename for matching
            base = os.path.basename(name)
            if base not in image_map:
                image_map[base] = data

    page_width = A4[0] - 30*mm  # usable width

    for item in book.get_items():
        if item.get_type() == epub.ITEM_DOCUMENT:
            content = item.get_body_content().decode('utf-8', errors='replace')
            soup = BeautifulSoup(content, 'html.parser')

            for element in soup.descendants:
                if element.name in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
                    text = element.get_text(strip=True)
                    if text:
                        story.append(Paragraph(text, heading_style))

                elif element.name == 'p':
                    text = element.get_text(strip=True)
                    if text:
                        safe_text = html_module.escape(text)
                        story.append(Paragraph(safe_text, normal_style))

                elif element.name == 'img':
                    src = element.get('src', '')
                    if not src:
                        continue
                    img_data = None
                    img_path = src
                    # Try to resolve relative paths
                    if img_path in image_map:
                        img_data = image_map[img_path]
                    elif os.path.basename(img_path) in image_map:
                        img_data = image_map[os.path.basename(img_path)]
                    else:
                        # Try matching by longest suffix
                        matches = [k for k in image_map if img_path.endswith(k) or k.endswith(img_path)]
                        if matches:
                            img_data = image_map[matches[0]]

                    if img_data:
                        try:
                            pil_img = Image.open(io.BytesIO(img_data))
                            # Convert to RGB if needed
                            if pil_img.mode in ('RGBA', 'P'):
                                pil_img = pil_img.convert('RGB')
                            img_width, img_height = pil_img.size
                            # Scale to fit page width
                            max_width = page_width
                            if img_width > max_width:
                                ratio = max_width / img_width
                                img_width = max_width
                                img_height = img_height * ratio
                            # Limit height to avoid too large images
                            max_height = A4[1] * 0.6
                            if img_height > max_height:
                                ratio = max_height / img_height
                                img_height = max_height
                                img_width = img_width * ratio

                            img_buf = io.BytesIO()
                            pil_img.save(img_buf, format='JPEG', quality=85)
                            img_buf.seek(0)
                            rl_img = RLImage(img_buf, width=img_width, height=img_height)
                            story.append(Spacer(1, 4*mm))
                            story.append(rl_img)
                            story.append(Spacer(1, 4*mm))
                        except Exception as e:
                            print(f"  [Warning] Could not process image {src}: {e}")

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
