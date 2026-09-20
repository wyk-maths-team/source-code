import re
from urllib.parse import urlparse
from bs4 import BeautifulSoup

def extract_domains_to_hosts(html_content, output_file='hosts_entries.txt'):
    soup = BeautifulSoup(html_content, 'html.parser')
    domains = set()
    for a_tag in soup.find_all('a', href=True):
        href = a_tag['href'].strip()
        if not href:
            continue
        parsed = urlparse(href)
        domain = parsed.netloc.split(':')[0]  # 去掉端口
        if domain:
            domains.add(domain.lower())
    
    with open(output_file, 'w') as f:
        for d in sorted(domains):
            f.write(f"127.0.0.1 {d}\n")
    print(f"已写入 {len(domains)} 条记录到 {output_file}")

# 用法：读取你的 HTML 文件
with open('private/temp.html', 'r', encoding='utf-8') as f:
    html = f.read()
extract_domains_to_hosts(html)