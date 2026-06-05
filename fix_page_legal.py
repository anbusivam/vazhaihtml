import re, glob

for fname in glob.glob("*.html"):
    if fname in ("common-header.html", "common-bottom.html", "atemp.html", "fix_page_legal.py"):
        continue
    
    with open(fname, 'r') as f:
        content = f.read()
    
    # Insert page-legal right before </main>
    legal_html = '<div class="page-legal">\n  <a href="/terms">Terms</a>\n  <span>·</span>\n  <a href="/privacy-policy">Privacy</a>\n</div>\n'
    
    # Only insert if </main> exists and we haven't already done it
    if '</main>' in content and 'page-legal' not in content:
        content = content.replace('</main>', legal_html + '</main>')
        print(f"Added to: {fname}")
    elif 'page-legal' in content:
        print(f"Skipped (already has): {fname}")
    else:
        print(f"No </main> found: {fname}")
    
    with open(fname, 'w') as f:
        f.write(content)