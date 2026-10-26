import os
import time
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin

HTML_CONTENT = """
<table border="1" width="105%" id="table1">
		<tbody><tr>
			<td width="97">　</td>
			<td width="126" align="center">
			<span style="font-size: 15pt" lang="zh-cn">龍虎榜</span></td>
			<td align="center"><span style="font-size: 15pt" lang="zh-cn">國際比賽</span></td>
			<td width="137" align="center">
			<span style="font-size: 15pt" lang="zh-cn">比賽花絮</span></td>
			<td width="163" align="center">
			<span style="font-size: 15pt" lang="zh-cn">試題庫</span></td>
		</tr>
          <tr>
            <td>2025-2026</td>
            <td><a href="http://www.hkymhasc.org/2025-2026/hkymhasc1.html">團體</a>&nbsp;&nbsp;&nbsp; <a href="http://www.hkymhasc.org/2025-2026/2526個人獲獎名單.pdf">個人</a></td>
            <td>&nbsp;</td>
            <td><a href="http://www.hkymhasc.org/2025-2026/hkymhascphotoFS.html">花絮</a></td>
            <td><a href="../2025-2026/2025-2026香港青少年數學精英選拔賽Questions.pdf">試題 </a>&nbsp;&nbsp;&nbsp;&nbsp; <a href="../2025-2026/2025-2026香港青少年數學精英選拔賽Solution.pdf">題解</a></td>
          </tr>
          <tr>
            <td>2024-2025</td>
            <td><a href="http://www.hkymhasc.org/2024-2025/hkymhasc1.html">團體</a>&nbsp;&nbsp;&nbsp; <a href="http://www.hkymhasc.org/2024-2025/2425個人獲獎名單.pdf">個人</a></td>
            <td><a href="http://www.hkymhasc.org/TL2025/index.htm"><strong>越南蜆港市</strong></a></td>
            <td><a href="http://www.hkymhasc.org/2024-2025/hkymhascphotoFS.html">花絮</a></td>
            <td><a href="../2024-2025/2024-2025香港青少年數學精英選拔賽Questions.pdf">試題 </a>&nbsp;&nbsp;&nbsp;&nbsp; <a href="../2024-2025/2024-2025香港青少年數學精英選拔賽Solution.pdf">題解</a></td>
          </tr>
          <tr>
            <td>2023-2024</td>
            <td><a href="http://www.hkymhasc.org/2023-2024/hkymhasc1.html">團體</a>&nbsp;&nbsp;&nbsp; <a href="http://www.hkymhasc.org/2023-2024/2324個人獲獎名單new.pdf">個人</a></td>
            <td></td>
            <td><a href="http://www.hkymhasc.org/2023-2024/hkymhascphotoFS.html">花絮</a></td>
            <td><a href="http://www.hkymhasc.org/2023-2024/2023-2024香港青少年數學精英選拔賽Questions.pdf">試題 </a>&nbsp;&nbsp;&nbsp;&nbsp; <a href="http://www.hkymhasc.org/2023-2024/2023-2024香港青少年數學精英選拔賽Solution.pdf">題解</a></td>
          </tr>
          <tr>
		    <td>2022-2023</td>
		    <td><a href="http://www.hkymhasc.org/2022-2023/hkymhasc1.html">團體</a>&nbsp;&nbsp;&nbsp; <a href="http://www.hkymhasc.org/2022-2023/2223個人獲獎名單.pdf">個人</a></td>
		    <td><a href="http://www.hkymhasc.org/TL2023/index.htm"><strong>保加利亞布爾加斯</strong></a></td>
		    <td><a href="http://www.hkymhasc.org/2022-2023/hkymhascphotoFS.html">花絮</a></td>
		    <td><a href="http://www.hkymhasc.org/2022-2023/2022-2023香港青少年數學精英選拔賽Questions.pdf">試題 </a>&nbsp;&nbsp;&nbsp;&nbsp; <a href="http://www.hkymhasc.org/2022-2023/2022-2023香港青少年數學精英選拔賽Solution.pdf">題解</a></td>
	      </tr>
		  <tr>
		    <td>2021-2022</td>
		    <td>取消</td>
		    <td>取消</td>
		    <td>取消</td>
		    <td>取消</td>
	      </tr>
		  <tr>
		    <td>2020-2021</td>
		    <td>取消</td>
		    <td>取消</td>
		    <td>取消</td>
		    <td>取消</td>
	      </tr>
		  <tr>
		    <td>2019-2020</td>
		    <td>取消</td>
		    <td>取消</td>
		    <td>取消</td>
		    <td>取消</td>
	      </tr>
		  <tr>
		    <td>2018-2019</td>
		    <td><a href="http://www.hkymhasc.org/2018-2019/hkymhasc1.html">團體</a>&nbsp;&nbsp;&nbsp; <a href="http://www.hkymhasc.org/2018-2019/1819個人獲獎名單.pdf">個人</a></td>
		    <td><a href="http://www.hkymhasc.org/TL2019/index.htm"><strong>南非德班市</strong></a></td>
		    <td><a href="http://www.hkymhasc.org/2018-2019/hkymhascphotoFS.html">花絮</a></td>
		    <td><a href="http://www.hkymhasc.org/2018-2019/2018-2019香港青少年學精英選拔賽 Questions final v4.pdf">試題 </a>&nbsp;&nbsp;&nbsp;&nbsp; <a href="http://www.hkymhasc.org/2018-2019/2018-2019香港青少年學精英選拔賽 solution final v4.pdf">題解</a></td>
	      </tr>
		  <tr>
		    <td>2017-2018</td>
		    <td><a href="http://www.hkymhasc.org/2017-2018/hkymhasc2.html">團體</a>&nbsp;&nbsp;&nbsp; <a href="http://www.hkymhasc.org/2017-2018/1718pnl.pdf">個人</a></td>
		    <td><a href="http://www.hkymhasc.org/TL2018/index.htm"><strong>保加利亞布爾加斯</strong></a></td>
		    <td><a href="http://www.hkymhasc.org/2017-2018/hkymhascphoto3.html">花絮</a></td>
		    <td><a href="http://www.hkymhasc.org/2017-2018/HKYMHASC_2018_Q.pdf">試題 </a>&nbsp;&nbsp;&nbsp;&nbsp; <a href="http://www.hkymhasc.org/2017-2018/HKYMHASC_2018_S.pdf">題解</a></td>
	      </tr>
		  <tr>
			<td width="97">2016-2017</td>
			<td width="126">
			<a href="http://www.hkymhasc.org/2016-2017/hkymhasc1.html">團體</a>&nbsp;&nbsp;&nbsp;
			<a href="http://www.hkymhasc.org/2016-2017/1617ppnl.pdf">個人</a></td>
			<td>　</td>
			<td width="137"><a href="http://www.hkymhasc.org/2016-2017/hkymhascphoto.html">花絮</a>　</td>
			<td width="163">
			<a href="http://www.hkymhasc.org/2016-2017/HKYMHASC_2017_Q.pdf">試題			</a>&nbsp;&nbsp;&nbsp;&nbsp;
			<a href="http://www.hkymhasc.org/2016-2017/HKYMHASC_2017_S.pdf">題解</a></td>
		</tr>
		<tr>
			<td width="97">2015-2016</td>
			<td width="126"><span lang="zh-cn">
			<a target="_blank" href="http://www.hkymhasc.org/lhb16.htm">團體</a>&nbsp;&nbsp;&nbsp;&nbsp;</span><span lang="zh-tw"><a href="http://www.hkymhasc.org/2016-2017/1516ppnl.pdf">個人</a></span></td>
			<td><a href="http://www.hkymhasc.org/TL2016/index.htm"><strong>泰國清邁</strong></a>　</td>
			<td width="137"><a href="http://www.hkymhasc.org/bshx16.htm">花絮</a>　</td>
			<td width="163"><span lang="zh-cn">
			<a target="_blank" href="http://www.hkymhasc.org/qalib/2016Q.pdf">試題&nbsp;</a>&nbsp;&nbsp;&nbsp;&nbsp;
			<a target="_blank" href="http://www.hkymhasc.org/qalib/2016S.pdf">題解</a></span></td>
		</tr>
		<tr>
			<td width="97">2014-2015</td>
			<td width="126"><span lang="zh-cn">
			<a target="_blank" href="http://www.hkymhasc.org/downloadr/r2015.htm">團體</a>&nbsp;&nbsp;&nbsp;&nbsp;
			<a target="_blank" href="http://www.hkymhasc.org/downloadr/r2015b.pdf">個人</a></span></td>
			<td><a href="http://www.hkymhasc.org/changchun2015/hangchun.htm"><strong>中國長春</strong></a>　</td>
			<td width="137"><a href="http://www.hkymhasc.org/bshx15.htm">花絮</a>　</td>
			<td width="163"><span lang="zh-cn">
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/q2015.pdf">試題</a>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/s2015.pdf">題解</a></span></td>
		</tr>
		<tr>
			<td width="97">2013-2014</td>
			<td width="126"><span lang="zh-cn"><a href="http://www.hkymhasc.org/downloadr/r2014.htm">團體</a>&nbsp;&nbsp;&nbsp;&nbsp;
			<a target="_blank" href="http://www.hkymhasc.org/downloadr/r2014b.pdf">個人</a></span></td>
			<td><a href="http://www.hkymhasc.org/korea2014/r2014.htm"><strong>韓國大川市</strong></a>　</td>
			<td width="137"><a href="http://www.hkymhasc.org/bshx14.htm">花絮</a>　</td>
			<td width="163"><span lang="zh-cn">
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/q2014.pdf">試題</a>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/s2014.pdf">題解</a></span></td>
		</tr>
		<tr>
			<td width="97">2012-2013</td>
			<td width="126"><span lang="zh-cn"><a href="http://www.hkymhasc.org/downloadr/r2013.htm">團體</a>&nbsp;&nbsp;&nbsp;&nbsp;
			<a target="_blank" href="http://www.hkymhasc.org/downloadr/r2013b.pdf">個人</a></span></td>
			<td><a href="http://www.hkymhasc.org/bulgaria2013/bulgaria.htm"><strong>保加利亞布爾加斯</strong></a>　</td>
			<td width="137"><a href="http://www.hkymhasc.org/bshx13.htm">花絮</a>　</td>
			<td width="163"><span lang="zh-cn">
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/q2013.pdf">試題</a>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/s2013.pdf">題解</a></span></td>
		</tr>
		<tr>
			<td width="97">2011-2012</td>
			<td width="126"><span lang="zh-cn"><a href="http://www.hkymhasc.org/downloadr/r2012.htm">團體</a>&nbsp;&nbsp;&nbsp;&nbsp;
			<a target="_blank" href="http://www.hkymhasc.org/downloadr/r2012b.pdf">個人</a></span></td>
			<td><a href="http://www.hkymhasc.org/taiwan2012/taiwan12.htm"><strong>台灣台北市</strong></a>　</td>
			<td width="137"><a href="http://www.hkymhasc.org/bshx12.htm">花絮</a>　</td>
			<td width="163"><span lang="zh-cn">
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/q2012.pdf">試題</a>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/s2012.pdf">題解</a></span></td>
		</tr>
		<tr>
			<td width="97">2010-2011</td>
			<td width="126"><span lang="zh-cn"><a href="http://www.hkymhasc.org/downloadr/r2011.htm">團體</a>&nbsp;&nbsp;&nbsp;&nbsp;
			<a target="_blank" href="http://www.hkymhasc.org/downloadr/r2011b.pdf">個人</a></span></td>
			<td><a href="http://www.hkymhasc.org/iimc.htm"><strong>印尼峇里島</strong></a>　</td>
			<td width="137"><a href="http://www.hkymhasc.org/bshx11.htm">花絮</a>　</td>
			<td width="163"><span lang="zh-cn">
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/q2011.pdf">試題</a>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/s2011.pdf">題解</a></span></td>
		</tr>
		<tr>
			<td width="97">2009-2010</td>
			<td width="126"><span lang="zh-cn"><a href="http://www.hkymhasc.org/downloadr/r2010.htm">團體</a>&nbsp;&nbsp;&nbsp;&nbsp;
			<a target="_blank" href="http://www.hkymhasc.org/downloadr/r2010b.pdf">個人</a></span></td>
			<td><a href="http://www.hkymhasc.org/2010in.htm"><strong>南韓仁川市</strong></a>　</td>
			<td width="137"><a href="http://www.hkymhasc.org/bshx10.htm">花絮</a>　</td>
			<td width="163"><span lang="zh-cn">
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/q2010.pdf">試題</a>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/s2010.pdf">題解</a></span></td>
		</tr>
		<tr>
			<td width="97">2008-2009</td>
			<td width="126"><span lang="zh-cn"><a href="http://www.hkymhasc.org/downloadr/r2009.htm">團體</a>&nbsp;&nbsp;&nbsp;&nbsp;
			<a target="_blank" href="http://www.hkymhasc.org/downloadr/r2009b.pdf">個人</a></span></td>
			<td><a href="http://www.hkymhasc.org/2009in.htm"><strong>南非德班市</strong></a>　</td>
			<td width="137"><a href="http://www.hkymhasc.org/bshx09.htm">花絮</a>　</td>
			<td width="163"><span lang="zh-cn">
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/q2009.pdf">試題</a>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/s2009.pdf">題解</a></span></td>
		</tr>
		<tr>
			<td width="97">2007-2008</td>
			<td width="126"><span lang="zh-cn"><a href="http://www.hkymhasc.org/downloadr/r2008.htm">團體</a>&nbsp;&nbsp;&nbsp;&nbsp;
			<a target="_blank" href="http://www.hkymhasc.org/downloadr/r2008b.pdf">個人</a></span></td>
			<td><a href="http://www.hkymhasc.org/2008in.htm"><strong>泰國清邁</strong></a>　</td>
			<td width="137"><span lang="zh-cn">
			<a href="http://www.hkymhasc.org/downloads/p2008/bshx08.htm">花絮</a></span></td>
			<td width="163"><span lang="zh-cn">
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/q2008.pdf">試題</a>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/s2008.pdf">題解</a></span></td>
		</tr>
		<tr>
			<td width="97">2006-2007</td>
			<td width="126"><span lang="zh-cn"><a href="http://www.hkymhasc.org/downloadr/r2007.htm">團體</a>&nbsp;&nbsp;&nbsp;&nbsp;
			<a target="_blank" href="http://www.hkymhasc.org/downloadr/r2007b.pdf">個人</a></span></td>
			<td><span lang="zh-cn">
			<a href="http://www.hkymhasc.org/downloadi/i2007/2007mii.html">中國長春</a></span></td>
			<td width="137"><span lang="zh-cn">
			<a href="http://www.hkymhasc.org/downloads/p2007/bshx07.htm">花絮</a></span></td>
			<td width="163"><span lang="zh-cn">
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/q2007.pdf">試題</a>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/s2007.pdf">題解</a></span></td>
		</tr>
		<tr>
			<td width="97">2005-2006</td>
			<td width="126"><span lang="zh-cn"><a href="http://www.hkymhasc.org/downloadr/r2006.htm">團體</a>&nbsp;&nbsp;&nbsp;&nbsp;
			<a href="http://www.hkymhasc.org/downloadr/r2006.htm">個人</a></span></td>
			<td><span lang="zh-cn">
			<a href="http://www.hkymhasc.org/downloadi/i2006/hkmhascwz.htm">中國溫州</a></span></td>
			<td width="137"><span lang="zh-cn">
			<a href="http://www.hkymhasc.org/downloads/p2006/hx06.htm">花絮</a></span></td>
			<td width="163"><span lang="zh-cn">
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/q2006.pdf">試題</a>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/s2006.pdf">題解</a></span></td>
		</tr>
		<tr>
			<td width="97">2004-2005</td>
			<td width="126"><span lang="zh-cn"><a href="http://www.hkymhasc.org/downloadr/r2005a.html">團體</a>&nbsp;&nbsp;&nbsp;&nbsp;
			<a target="_blank" href="http://www.hkymhasc.org/downloadr/r2005b.htm">個人</a></span></td>
			<td><span lang="zh-cn">
			<a href="http://www.hkymhasc.org/downloadi/i2005/hkmhasc2005gx.htm">台灣高雄</a></span></td>
			<td width="137"><span lang="zh-cn">
			<a href="http://www.hkymhasc.org/downloads/p2005/photo2005.html">花絮</a></span></td>
			<td width="163"><span lang="zh-cn">
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/q2005.pdf">試題</a>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/s2005.pdf">題解</a></span></td>
		</tr>
		<tr>
			<td width="97">2003-2004</td>
			<td width="126"><span lang="zh-cn">
			<a href="http://www.hkymhasc.org/downloadr/r2004/h2004.html">團體</a>&nbsp;&nbsp;&nbsp;&nbsp;
			<a href="http://www.hkymhasc.org/downloadr/r2004/hp2004.html">個人</a></span></td>
			<td><span lang="zh-cn">
			<a href="http://www.hkymhasc.org/downloadi/i2004/i2004.html">澳門</a></span></td>
			<td width="137"><span lang="zh-cn">
			<a href="http://www.hkymhasc.org/downloads/p2004/photo2004.html">花絮</a></span></td>
			<td width="163"><span lang="zh-cn">
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/q2004new.pdf">試題</a>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/s2004new.pdf">題解</a></span></td>
		</tr>
		<tr>
			<td width="97">2002-2003</td>
			<td width="126"><span lang="zh-cn">
			<a href="http://www.hkymhasc.org/downloadr/r2003/mcss.html">團體</a>&nbsp;&nbsp;&nbsp;&nbsp;
			<a target="_blank" href="http://www.hkymhasc.org/downloadr/r2003/pr2003.htm">個人</a></span></td>
			<td>　</td>
			<td width="137"><span lang="zh-cn">
			<a href="http://www.hkymhasc.org/downloads/p2003/photo2003.html">花絮</a></span></td>
			<td width="163"><span lang="zh-cn">
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/q2003new.pdf">試題</a>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/s2003new.pdf">題解</a></span></td>
		</tr>
		<tr>
			<td width="97">2001-2002</td>
			<td width="126"><span lang="zh-cn">
			<a href="http://www.hkymhasc.org/downloadr/r2002/q31.htm">團體</a>&nbsp;&nbsp;&nbsp;&nbsp;
			<a target="_blank" href="http://www.hkymhasc.org/downloadr/r2002/x2002.htm">個人</a></span></td>
			<td><span lang="zh-cn">
			<a href="http://www.hkymhasc.org/downloadi/i2002/4th.html">印度</a></span></td>
			<td width="137"><span lang="zh-cn">
			<a href="http://www.hkymhasc.org/downloads/p2002/02.html">花絮</a></span></td>
			<td width="163"><span lang="zh-cn">
			<a href="http://www.hkymhasc.org/downloadlib/q2002new.pdf">試題</a>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/s2002new.pdf">題解</a></span></td>
		</tr>
		<tr>
			<td width="97">2000-2001</td>
			<td width="126"><span lang="zh-cn"><a href="http://www.hkymhasc.org/downloadr/r2001.htm">團體</a>&nbsp;&nbsp;&nbsp;&nbsp; 
			<a target="_blank" href="http://www.hkymhasc.org/downloadr/r2001/x53.htm">個人</a></span></td>
			<td>　</td>
			<td width="137"><span lang="zh-cn">
			<a href="http://www.hkymhasc.org/downloads/p2001/01.htm">花絮</a></span></td>
			<td width="163"><span lang="zh-cn">
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/q2001new.pdf">試題</a>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/s2001new.pdf">題解</a></span></td>
		</tr>
		<tr>
			<td width="97">1999-2000</td>
			<td width="126"><span lang="zh-cn"><a href="http://www.hkymhasc.org/downloadr/r2000.htm">團體</a>&nbsp;&nbsp;&nbsp;&nbsp; 
			個人</span></td>
			<td>　</td>
			<td width="137"><span lang="zh-cn">
			<a href="http://www.hkymhasc.org/dwonloads/p2000/new_page_16.htm">花絮</a></span></td>
			<td width="163"><span lang="zh-cn">
			<a href="http://www.hkymhasc.org/downloadlib/q2000new.pdf">試題</a>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 
			<a target="_blank" href="http://www.hkymhasc.org/downloadlib/s2000new.pdf">題解</a></span></td>
		</tr>
		<tr>
			<td width="97">1989-1999</td>
			<td width="126"><span lang="zh-cn"><a href="http://www.hkymhasc.org/downloadr/r1999.htm">團體</a>&nbsp;&nbsp;&nbsp;&nbsp; 
			個人</span></td>
			<td><span lang="zh-cn">台灣</span></td>
			<td width="137"><span lang="zh-cn">
			<a href="http://www.hkymhasc.org/downloads/p1999/new_page_51.htm">花絮</a></span></td>
			<td width="163"><span lang="zh-cn"><a href="http://www.hkymhasc.org/downloadlib/q1999new.pdf">
			試題</a>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
			<a href="http://www.hkymhasc.org/downloadlib/s1999new.pdf">題解</a></span></td>
		</tr>
	</tbody></table>
"""

BASE_URL = "http://hkymhasc.org/"

def extract_pdf_links(html_content):
    soup = BeautifulSoup(html_content, 'html.parser')
    table = soup.find('table', id='table1')
    if not table:
        print("未找到表格，请检查 HTML 内容")
        return []

    rows = table.find_all('tr')
    pdf_links = []

    for row in rows[1:]:
        tds = row.find_all('td')
        if len(tds) < 5:
            continue

        year_cell = tds[0]
        year = year_cell.get_text(strip=True) if year_cell else "未知年份"

        last_cell = tds[4]
        links = last_cell.find_all('a')
        for a in links:
            href = a.get('href')
            if not href:
                continue
            if href.lower().endswith('.pdf'):
                full_url = urljoin(BASE_URL, href)
                link_text = a.get_text(strip=True).lower()
                if '題解' in link_text or 'solution' in link_text:
                    file_type = 'Solution'
                else:
                    file_type = 'Questions' 

                pdf_links.append({
                    'year': year,
                    'type': file_type,
                    'url': full_url,
                    'filename': f"{year}_{file_type}.pdf"
                })

    return pdf_links

def download_file(url, save_path, retries=3):
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
    for attempt in range(retries):
        try:
            response = requests.get(url, headers=headers, timeout=30)
            if response.status_code == 200:
                with open(save_path, 'wb') as f:
                    f.write(response.content)
                print(f"下载成功: {save_path}")
                return True
            else:
                print(f"下载失败 (状态码 {response.status_code}): {url}")
        except Exception as e:
            print(f"尝试 {attempt+1}/{retries} 出错: {e}")
        time.sleep(2)  # 等待后重试
    return False

def main():
    # 创建下载目录
    download_dir = "downloaded_pdfs"
    os.makedirs(download_dir, exist_ok=True)

    links = extract_pdf_links(HTML_CONTENT)
    if not links:
        print("未提取到任何 PDF 链接，请检查 HTML 内容或选择器。")
        return

    print(f"共找到 {len(links)} 个 PDF 文件，开始下载...")
    for item in links:
        save_path = os.path.join(download_dir, item['filename'])
        if os.path.exists(save_path):
            print(f"文件已存在，跳过: {save_path}")
            continue
        print(f"正在下载: {item['filename']} 从 {item['url']}")
        success = download_file(item['url'], save_path)
        if not success:
            print(f"下载失败: {item['filename']}")
        time.sleep(1)  

    print("所有下载任务完成！")

if __name__ == "__main__":
    main()