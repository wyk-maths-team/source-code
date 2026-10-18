        (function() {
            const REPO_OWNER = 'wyk-math-team';
            const REPO_NAME = 'resources';
            // 基础路径（如果你把 notes 放在 resources/ 根目录下，就留空字符串）
            const BASE_PATH = ''; // 如果放在 resources/notes/ 下，就写 'notes'

            const listEl = document.getElementById('fileList');
            const breadcrumbEl = document.getElementById('breadcrumb');
            let currentPath = BASE_PATH;

            // 工具函数：拼接 GitHub API URL
            function getApiUrl(path) {
                return `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
            }

            // 获取文件/文件夹的 Raw 或 CDN 链接
            function getDownloadUrl(item) {
                // 优先使用 jsDelivr CDN，加速访问
                const cleanPath = item.path; // 如 "notes/chapter1.pdf"
                return `https://cdn.jsdelivr.net/gh/${REPO_OWNER}/${REPO_NAME}/${cleanPath}`;
            }

            // 渲染当前目录
            async function loadDirectory(path) {
                // 显示加载状态
                listEl.innerHTML = '<li class="loading-msg"><i class="fas fa-spinner fa-spin"></i> Loading...</li>';
                
                // 更新面包屑显示当前路径
                const displayPath = path || 'Root';
                breadcrumbEl.innerHTML = `<span onclick="window.__navigateTo('')"><i class="fas fa-home"></i> Root</span>`;
                if (path) {
                    const parts = path.split('/').filter(Boolean);
                    let current = '';
                    parts.forEach((part, index) => {
                        current += (index === 0 ? '' : '/') + part;
                        const isLast = index === parts.length - 1;
                        if (isLast) {
                            breadcrumbEl.innerHTML += ` / <span style="font-weight:700;">${part}</span>`;
                        } else {
                            breadcrumbEl.innerHTML += ` / <span onclick="window.__navigateTo('${current}')">${part}</span>`;
                        }
                    });
                }

                try {
                    const url = getApiUrl(path);
                    const response = await fetch(url);
                    
                    if (response.status === 404) {
                        listEl.innerHTML = '<li class="loading-msg">Folder not found.</li>';
                        return;
                    }

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }

                    const data = await response.json();
                    
                    // GitHub API 返回的是数组（如果是文件则返回对象，但这里我们只处理目录）
                    if (!Array.isArray(data)) {
                        // 如果直接点到了单个文件，直接跳转下载
                        window.location.href = getDownloadUrl(data);
                        return;
                    }

                    // 排序：文件夹优先，再按名称排序
                    data.sort((a, b) => {
                        if (a.type === 'dir' && b.type !== 'dir') return -1;
                        if (a.type !== 'dir' && b.type === 'dir') return 1;
                        return a.name.localeCompare(b.name);
                    });

                    // 如果当前不在根目录，添加一个“返回上级”的入口
                    let html = '';
                    if (path !== BASE_PATH) {
                        const parentPath = path.split('/').slice(0, -1).join('/');
                        html += `
                            <li onclick="window.__navigateTo('${parentPath}')" style="cursor:pointer; color:var(--accent);">
                                <span class="item-icon"><i class="fas fa-level-up-alt"></i></span>
                                <span class="item-name">..</span>
                            </li>
                        `;
                    }

                    // 渲染文件和文件夹
                    const HIDDEN_NAMES = ['script', 'static', 'tools', 'web_css', '.github'];
                    data.filter(item => !HIDDEN_NAMES.includes(item.name)).forEach(item => {
                        const isDir = item.type === 'dir';
                        let icon;
                        if (isDir) {
                            icon = '<i class="fas fa-folder" style="color:#f0b429;"></i>';
                        } else if (item.name.toLowerCase().endsWith('.pdf')) {
                            icon = '<i class="fas fa-file-pdf" style="color:#e74c3c;"></i>';
                        } else if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(item.name)) {
                            icon = '<i class="fas fa-file-image" style="color:#3498db;"></i>';
                        } else if (/\.(zip|rar|7z|tar|gz)$/i.test(item.name)) {
                            icon = '<i class="fas fa-file-archive" style="color:#8e44ad;"></i>';
                        } else if (/\.(docx?|odt)$/i.test(item.name)) {
                            icon = '<i class="fas fa-file-word" style="color:#2b579a;"></i>';
                        } else if (/\.(xlsx?|ods|csv)$/i.test(item.name)) {
                            icon = '<i class="fas fa-file-excel" style="color:#217346;"></i>';
                        } else if (/\.(pptx?|odp)$/i.test(item.name)) {
                            icon = '<i class="fas fa-file-powerpoint" style="color:#d24726;"></i>';
                        } else if (/\.(tex|md|txt|log)$/i.test(item.name)) {
                            icon = '<i class="fas fa-file-alt" style="color:#7f8c8d;"></i>';
                        } else {
                            icon = '<i class="fas fa-file" style="color:#7f8c8d;"></i>';
                        }
                        const size = item.size ? `${(item.size / 1024).toFixed(1)} KB` : '';
                        const displayName = item.name;

                        if (isDir) {
                            // 文件夹：点击进入子目录
                            html += `
                                <li onclick="window.__navigateTo('${item.path}')">
                                    <span class="item-icon">${icon}</span>
                                    <span class="item-name"><strong>${displayName}</strong></span>
                                    <span class="item-size">${size}</span>
                                </li>
                            `;
                        } else {
                            // 文件：点击直接打开（或下载）
                            const downloadUrl = getDownloadUrl(item);
                            html += `
                                <li onclick="window.open('${downloadUrl}', '_blank')">
                                    <span class="item-icon">${icon}</span>
                                    <span class="item-name">${displayName}</span>
                                    <span class="item-size">${size}</span>
                                </li>
                            `;
                        }
                    });

                    if (data.length === 0) {
                        html = '<li class="loading-msg">This folder is empty.</li>';
                    }

                    listEl.innerHTML = html;

                } catch (err) {
                    console.error(err);
                    listEl.innerHTML = `<li class="loading-msg" style="color:var(--danger);">Failed to load directory: ${err.message}</li>`;
                }
            }

            // 暴露导航函数给全局，以便 onclick 调用
            window.__navigateTo = function(path) {
                currentPath = path || BASE_PATH;
                loadDirectory(currentPath);
                // 更新浏览器 URL 历史记录（可选）
                if (history.pushState) {
                    const newUrl = window.location.pathname + (path ? `?path=${encodeURIComponent(path)}` : '');
                    history.pushState({ path }, '', newUrl);
                }
            };

            // 监听浏览器返回/前进按钮
            window.addEventListener('popstate', (e) => {
                const params = new URLSearchParams(window.location.search);
                const path = params.get('path') || BASE_PATH;
                loadDirectory(path);
            });

            // 启动：从 URL 参数获取路径，否则加载根目录
            (function init() {
                const params = new URLSearchParams(window.location.search);
                const startPath = params.get('path') || BASE_PATH;
                currentPath = startPath;
                loadDirectory(startPath);
            })();

        })();
    