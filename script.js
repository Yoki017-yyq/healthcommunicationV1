// 页面切换功能
function showPage(pageId) {
  document.querySelectorAll(".page").forEach((page) => {
    page.classList.remove("active");
  });
  document.getElementById(pageId).classList.add("active");
}

// 文件处理
async function handleFileUpload(file) {
  const text = await file.text();
  return text;
}

// 添加消息到对话区域
function addMessage(type, content, isMarkdown = false) {
  const scriptWorkspace = document.getElementById("scriptWorkspace");
  const messageDiv = document.createElement("div");
  messageDiv.className =
    "mb-3 d-flex " +
    (type === "user" ? "justify-content-end" : "justify-content-start");

  const messageContent = document.createElement("div");
  messageContent.className =
    `message ${type} p-3 rounded ` +
    (type === "user" ? "bg-primary text-white" : "bg-light");
  messageContent.style.maxWidth = "80%";

  if (isMarkdown) {
    messageContent.innerHTML = marked.parse(content);
  } else {
    messageContent.textContent = content;
  }

  messageDiv.appendChild(messageContent);
  scriptWorkspace.appendChild(messageDiv);
  scriptWorkspace.scrollTop = scriptWorkspace.scrollHeight;
}

// 添加选择按钮到对话区域
function addChoiceButtons(choices, callback) {
  const scriptWorkspace = document.getElementById("scriptWorkspace");
  const choiceDiv = document.createElement("div");
  choiceDiv.className = "mb-3 d-flex justify-content-center";

  const choiceContainer = document.createElement("div");
  choiceContainer.className = "choice-container";
  choiceContainer.style.maxWidth = "100%";

  choices.forEach((choice, index) => {
    const button = document.createElement("button");
    button.className = "btn btn-outline-primary m-1 choice-btn";
    button.style.width = "100%";
    button.style.textAlign = "left";
    button.innerHTML = `
            <div class="d-flex align-items-start">
                <span class="badge bg-primary me-2">${index + 1}</span>
                <div>
                    <strong>${choice.title}</strong>
                    <br>
                    <small class="text-muted">${choice.description}</small>
                </div>
            </div>
        `;
    button.onclick = () => {
      // 禁用所有选择按钮
      document.querySelectorAll(".choice-btn").forEach((btn) => {
        btn.disabled = true;
        btn.classList.remove("btn-outline-primary");
        btn.classList.add("btn-secondary");
      });
      // 高亮选中的按钮
      button.classList.remove("btn-secondary");
      button.classList.add("btn-success");

      callback(choice, index);
    };
    choiceContainer.appendChild(button);
  });

  choiceDiv.appendChild(choiceContainer);
  scriptWorkspace.appendChild(choiceDiv);
  scriptWorkspace.scrollTop = scriptWorkspace.scrollHeight;
}

// 清空对话区域
function clearChat() {
  const scriptWorkspace = document.getElementById("scriptWorkspace");
  scriptWorkspace.innerHTML = "";
}

// API调用函数
async function callAPI(messages) {
  let retries = 0;

  async function attemptCall() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT);

      console.log("开始API调用...");
      const response = await fetch(CONFIG.API_BASE_URL + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CONFIG.API_KEY}`,
          Accept: "application/json",
        },
        body: JSON.stringify({
          model: CONFIG.MODEL,
          messages: messages,
          temperature: 0.7,
          max_tokens: 2000,
          stream: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("API错误详情:", errorData);
        throw new Error(
          errorData.error?.message || `HTTP错误: ${response.status}`
        );
      }

      const data = await response.json();
      console.log("API响应成功接收");

      if (!data.choices || !data.choices[0]?.message?.content) {
        throw new Error("API返回格式错误");
      }
      return data.choices[0].message.content.trim();
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error(`请求超时（${CONFIG.TIMEOUT / 1000}秒），请重试`);
      }
      throw error;
    }
  }

  while (retries < CONFIG.MAX_RETRIES) {
    try {
      return await attemptCall();
    } catch (error) {
      retries++;
      console.error(
        `API调用失败 (尝试 ${retries}/${CONFIG.MAX_RETRIES}):`,
        error
      );

      if (retries === CONFIG.MAX_RETRIES) {
        throw new Error(`API调用失败 (已重试${retries}次): ${error.message}`);
      }

      const waitTime = Math.min(1000 * Math.pow(2, retries - 1), 15000);
      console.log(`等待 ${waitTime / 1000} 秒后重试...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
}

// 显示错误消息
function showError(error, type = "error") {
  const scriptWorkspace = document.getElementById("scriptWorkspace");
  const errorDiv = document.createElement("div");
  errorDiv.className =
    "alert alert-danger alert-dismissible fade show mx-3 my-2";
  errorDiv.innerHTML = `
        <div class="d-flex align-items-center">
            <i class="fas fa-exclamation-circle me-2"></i>
            <div>
                <strong>错误信息：</strong><br>
                ${error.message || "未知错误"}
                ${retryButton(error)}
            </div>
        </div>
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;
  scriptWorkspace.appendChild(errorDiv);
  scriptWorkspace.scrollTop = scriptWorkspace.scrollHeight;
}

// 生成重试按钮
function retryButton(error) {
  if (error.message.includes("API调用失败")) {
    return `<br><button class="btn btn-sm btn-outline-danger mt-2" onclick="retryLastOperation()">
            <i class="fas fa-sync-alt"></i> 重试
        </button>`;
  }
  return "";
}

// 保存最后一次操作
let lastOperation = null;

// 重试上一次操作
async function retryLastOperation() {
  if (lastOperation) {
    await lastOperation();
  }
}

// 健康关键词分析
let healthKeywords = [];

async function analyzeHealthKeywords(content) {
  try {
    const messages = [
      { role: "system", content: PROMPTS.KEYWORD_ANALYSIS },
      { role: "user", content: content },
    ];

    const response = await callAPI(messages);
    // 清理响应文本，移除可能的markdown标记
    const cleanResponse = response.replace(/```json\s*|\s*```/g, "").trim();

    try {
      const result = JSON.parse(cleanResponse);
      if (result && Array.isArray(result.keywords)) {
        healthKeywords = result.keywords;
        updateKeywordsDisplay();
      } else {
        throw new Error("API返回的数据格式不正确");
      }
    } catch (parseError) {
      console.error("JSON解析错误:", parseError);
      // 尝试从文本中提取关键词
      const keywords = cleanResponse
        .replace(/[\[\]"]/g, "") // 移除方括号和引号
        .split(",") // 按逗号分割
        .map((k) => k.trim()) // 清理空白字符
        .filter((k) => k.length > 0); // 移除空字符串

      if (keywords.length > 0) {
        healthKeywords = keywords;
        updateKeywordsDisplay();
      } else {
        throw new Error("无法从API响应中提取关键词");
      }
    }
  } catch (error) {
    showError(error);
  }
}

function updateKeywordsDisplay() {
  const container = document.getElementById("keywordsContainer");
  container.innerHTML = "";

  healthKeywords.forEach((keyword) => {
    const tag = document.createElement("span");
    tag.className = "keyword-tag";
    tag.innerHTML = `
            ${keyword}
            <span class="remove-keyword" onclick="removeKeyword('${keyword}')">
                <i class="fas fa-times"></i>
            </span>
        `;
    container.appendChild(tag);
  });
}

function addKeyword() {
  const input = document.getElementById("keywordInput");
  const keyword = input.value.trim();

  if (keyword && !healthKeywords.includes(keyword)) {
    healthKeywords.push(keyword);
    updateKeywordsDisplay();
    input.value = "";
  }
}

function removeKeyword(keyword) {
  healthKeywords = healthKeywords.filter((k) => k !== keyword);
  updateKeywordsDisplay();
}

// 参考选项处理函数
function addReferenceKeyword(keyword) {
  if (!healthKeywords.includes(keyword)) {
    healthKeywords.push(keyword);
    updateKeywordsDisplay();
  }
}

function addReferenceType(type) {
  if (!healthKeywords.includes(type)) {
    healthKeywords.push(type);
    updateKeywordsDisplay();
  }
}

function addReferenceStyle(style) {
  if (!healthKeywords.includes(style)) {
    healthKeywords.push(style);
    updateKeywordsDisplay();
  }
}

// 生成状态管理
let generationState = {
  stage: "initial", // initial, outline, story_direction, script, editing
  content: "",
  selectedOutline: null,
  selectedDirection: null,
  currentScript: "",
};

// 主要的剧本生成功能 - 第一阶段：生成大纲预览
async function convertNovel() {
  const novelInput = document.getElementById("novelInput");
  const novelFile = document.getElementById("novelFile");
  let content = "";

  if (novelFile.files.length > 0) {
    try {
      content = await handleFileUpload(novelFile.files[0]);
    } catch (error) {
      showError(new Error("文件读取失败：" + error.message));
      return;
    }
  } else {
    content = novelInput.value;
  }

  if (!content) {
    showError(new Error("请输入健康相关的主题或上传文件"));
    return;
  }

  // 保存当前操作
  lastOperation = async () => {
    await convertNovel();
  };

  // 清空之前的对话
  clearChat();
  generationState.content = content;
  generationState.stage = "outline";

  // 显示加载状态
  const loadingDiv = document.createElement("div");
  loadingDiv.className = "text-center my-3";
  loadingDiv.innerHTML = `
        <div class="spinner-border text-primary" role="status"></div>
        <div class="mt-2 text-muted small">正在分析健康主题并生成大纲预览，请稍候...</div>
    `;
  document.getElementById("scriptWorkspace").appendChild(loadingDiv);

  try {
    // 首先分析健康关键词
    await analyzeHealthKeywords(content);

    // 调用API生成大纲预览
    const messages = [
      { role: "system", content: PROMPTS.OUTLINE_GENERATION },
      {
        role: "user",
        content: `健康主题：${content}\n关键词：${healthKeywords.join(", ")}`,
      },
    ];

    const response = await callAPI(messages);

    // 移除加载状态
    loadingDiv.remove();

    // 解析大纲选项
    const outlines = parseOutlineResponse(response);

    if (outlines.length === 0) {
      throw new Error("无法解析生成的大纲选项");
    }

    // 显示AI响应
    addMessage("ai", "已为您生成健康科普剧本的大纲预览，请选择您喜欢的方向：");

    // 显示选择按钮
    addChoiceButtons(outlines, selectOutline);

    // 清空输入
    novelInput.value = "";
    novelFile.value = "";
  } catch (error) {
    loadingDiv.remove();
    showError(error);
  }
}

// 解析大纲响应
function parseOutlineResponse(response) {
  const outlines = [];

  try {
    // 尝试解析JSON格式
    const cleanResponse = response.replace(/```json\s*|\s*```/g, "").trim();
    const parsed = JSON.parse(cleanResponse);
    if (parsed.outlines && Array.isArray(parsed.outlines)) {
      return parsed.outlines;
    }
  } catch (e) {
    // JSON解析失败，尝试文本解析
  }

  // 文本解析方式
  const lines = response.split("\n");
  let currentOutline = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // 检测标题行（数字开头或包含特定标记）
    const titleMatch = trimmed.match(/^(\d+[\.、]|\*\*|###?\s*)(.*)/);
    if (titleMatch && trimmed.length > 10) {
      if (currentOutline) {
        outlines.push(currentOutline);
      }
      currentOutline = {
        title: titleMatch[2].replace(/\*\*/g, "").trim(),
        description: "",
      };
    } else if (
      currentOutline &&
      trimmed.length > 0 &&
      !trimmed.startsWith("#")
    ) {
      // 添加到描述中
      currentOutline.description +=
        (currentOutline.description ? " " : "") + trimmed;
    }
  }

  if (currentOutline) {
    outlines.push(currentOutline);
  }

  // 如果还是没有解析出来，使用默认分割
  if (outlines.length === 0) {
    const sections = response.split(/\n\s*\n/);
    sections.forEach((section, index) => {
      const lines = section.trim().split("\n");
      if (lines.length > 0) {
        outlines.push({
          title: `方案 ${index + 1}`,
          description: lines.join(" ").substring(0, 200) + "...",
        });
      }
    });
  }

  return outlines.slice(0, 5); // 最多返回5个选项
}

// 第二阶段：选择大纲后生成故事走向
async function selectOutline(outline, index) {
  generationState.selectedOutline = outline;
  generationState.stage = "story_direction";

  addMessage("user", `已选择：${outline.title}`);

  // 显示加载状态
  const loadingDiv = document.createElement("div");
  loadingDiv.className = "text-center my-3";
  loadingDiv.innerHTML = `
        <div class="spinner-border text-primary" role="status"></div>
        <div class="mt-2 text-muted small">正在生成故事走向选项，请稍候...</div>
    `;
  document.getElementById("scriptWorkspace").appendChild(loadingDiv);

  try {
    const messages = [
      { role: "system", content: PROMPTS.STORY_DIRECTION },
      {
        role: "user",
        content: `选中的大纲：${outline.title}\n描述：${
          outline.description
        }\n原始主题：${generationState.content}\n关键词：${healthKeywords.join(
          ", "
        )}`,
      },
    ];

    const response = await callAPI(messages);

    // 移除加载状态
    loadingDiv.remove();

    // 解析故事走向
    const directions = parseDirectionResponse(response);

    if (directions.length === 0) {
      throw new Error("无法解析生成的故事走向");
    }

    addMessage("ai", "基于您选择的大纲，这里有几种故事发展方向：");

    // 显示选择按钮
    addChoiceButtons(directions, selectStoryDirection);
  } catch (error) {
    loadingDiv.remove();
    showError(error);
  }
}

// 解析故事走向响应
function parseDirectionResponse(response) {
  const directions = [];

  try {
    // 尝试解析JSON格式
    const cleanResponse = response.replace(/```json\s*|\s*```/g, "").trim();
    const parsed = JSON.parse(cleanResponse);
    if (parsed.directions && Array.isArray(parsed.directions)) {
      return parsed.directions;
    }
  } catch (e) {
    // JSON解析失败，尝试文本解析
  }

  // 文本解析方式
  const lines = response.split("\n");
  let currentDirection = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // 检测标题行
    const titleMatch = trimmed.match(/^(\d+[\.、]|\*\*|###?\s*)(.*)/);
    if (titleMatch && trimmed.length > 5) {
      if (currentDirection) {
        directions.push(currentDirection);
      }
      currentDirection = {
        title: titleMatch[2].replace(/\*\*/g, "").trim(),
        description: "",
      };
    } else if (
      currentDirection &&
      trimmed.length > 0 &&
      !trimmed.startsWith("#")
    ) {
      currentDirection.description +=
        (currentDirection.description ? " " : "") + trimmed;
    }
  }

  if (currentDirection) {
    directions.push(currentDirection);
  }

  // 默认分割方式
  if (directions.length === 0) {
    const sections = response.split(/\n\s*\n/);
    sections.forEach((section, index) => {
      const lines = section.trim().split("\n");
      if (lines.length > 0) {
        directions.push({
          title: `走向 ${index + 1}`,
          description: lines.join(" ").substring(0, 200) + "...",
        });
      }
    });
  }

  return directions.slice(0, 3); // 最多返回3个选项
}

// 第三阶段：选择故事走向后生成剧本
async function selectStoryDirection(direction, index) {
  generationState.selectedDirection = direction;
  generationState.stage = "script";

  addMessage("user", `已选择故事走向：${direction.title}`);

  // 显示加载状态
  const loadingDiv = document.createElement("div");
  loadingDiv.className = "text-center my-3";
  loadingDiv.innerHTML = `
        <div class="spinner-border text-primary" role="status"></div>
        <div class="mt-2 text-muted small">正在生成完整的健康科普剧本，请稍候...</div>
    `;
  document.getElementById("scriptWorkspace").appendChild(loadingDiv);

  try {
    const messages = [
      { role: "system", content: PROMPTS.SCRIPT_GENERATION },
      {
        role: "user",
        content: `
                原始主题：${generationState.content}
                选择的大纲：${generationState.selectedOutline.title} - ${
          generationState.selectedOutline.description
        }
                选择的故事走向：${direction.title} - ${direction.description}
                关键词：${healthKeywords.join(", ")}
            `,
      },
    ];

    const response = await callAPI(messages);

    // 移除加载状态
    loadingDiv.remove();

    // 显示生成的剧本
    addMessage("ai", "已为您生成完整的健康科普剧本：\n\n" + response, true);

    generationState.currentScript = response;
    generationState.stage = "editing";

    // 保存为第一个版本
    saveVersion(response);

    // 显示编辑选项
    showEditingOptions();

    // 显示分析按钮
    document.getElementById("analysisBtn").style.display = "inline-block";

    // 启用输入框
    document.getElementById("scriptInput").disabled = false;
    document.getElementById("sendButton").disabled = false;
  } catch (error) {
    loadingDiv.remove();
    showError(error);
  }
}

// 显示编辑选项
function showEditingOptions() {
  const scriptWorkspace = document.getElementById("scriptWorkspace");
  const optionsDiv = document.createElement("div");
  optionsDiv.className = "mt-3 p-3 bg-light rounded";
  optionsDiv.innerHTML = `
        <h6 class="mb-3">剧本已生成完成，您可以：</h6>
        <div class="d-flex flex-wrap gap-2">
            <button class="btn btn-outline-primary btn-sm" onclick="startEditing()">
                <i class="fas fa-edit"></i> 继续修改
            </button>
            <button class="btn btn-outline-success btn-sm" onclick="downloadScript()">
                <i class="fas fa-download"></i> 导出剧本
            </button>
            <button class="btn btn-outline-info btn-sm" onclick="showVersionHistory()">
                <i class="fas fa-history"></i> 查看历史版本
            </button>
            <button class="btn btn-outline-warning btn-sm" onclick="goToAnalysis()">
                <i class="fas fa-chart-line"></i> 分析剧本
            </button>
            <button class="btn btn-outline-secondary btn-sm" onclick="restartGeneration()">
                <i class="fas fa-redo"></i> 重新开始
            </button>
        </div>
    `;
  scriptWorkspace.appendChild(optionsDiv);
  scriptWorkspace.scrollTop = scriptWorkspace.scrollHeight;
}

// 开始编辑模式
function startEditing() {
  addMessage(
    "ai",
    "现在您可以输入修改建议，我会根据您的要求调整剧本。例如：\n- 增加更多专业解释\n- 添加实际案例\n- 调整语言风格\n- 修改某个情节"
  );

  // 显示快捷操作按钮
  document.getElementById("quickActions").style.display = "block";

  // 启用输入框
  const input = document.getElementById("scriptInput");
  input.disabled = false;
  input.placeholder = "输入修改建议...";
  input.focus();
}

// 重新开始生成
function restartGeneration() {
  if (confirm("确定要重新开始吗？当前的剧本和历史版本将会清除。")) {
    clearWorkspace();
    generationState = {
      stage: "initial",
      content: "",
      selectedOutline: null,
      selectedDirection: null,
      currentScript: "",
    };
  }
}

// 修改剧本功能（编辑阶段）
async function sendScriptMessage() {
  const input = document.getElementById("scriptInput");
  const message = input.value.trim();

  if (!message) return;

  if (generationState.stage !== "editing" || !generationState.currentScript) {
    showError(new Error("请先生成剧本或选择一个剧本版本"));
    return;
  }

  // 保存当前操作
  lastOperation = async () => {
    input.value = message;
    await sendScriptMessage();
  };

  // 添加用户消息
  addMessage("user", message);

  // 显示加载状态
  const loadingDiv = document.createElement("div");
  loadingDiv.className = "text-center my-3";
  loadingDiv.innerHTML = `
        <div class="spinner-border text-primary" role="status"></div>
        <div class="mt-2 text-muted small">正在修改剧本，请稍候...</div>
    `;
  document.getElementById("scriptWorkspace").appendChild(loadingDiv);

  try {
    // 准备修改提示
    const modifyPrompt = PROMPTS.MODIFY_SCRIPT.replace(
      "{suggestion}",
      message
    ).replace("{current_script}", generationState.currentScript);

    // 调用API
    const messages = [
      { role: "system", content: "你是一个专业的健康科普剧本顾问。" },
      { role: "user", content: modifyPrompt },
    ];

    const response = await callAPI(messages);

    // 移除加载状态
    loadingDiv.remove();

    // 显示AI响应
    addMessage("ai", "已根据您的建议修改：\n\n" + response, true);

    // 更新当前剧本
    generationState.currentScript = response;

    // 保存版本历史
    saveVersion(response);
  } catch (error) {
    loadingDiv.remove();
    showError(error);
  }

  // 清空输入框并聚焦
  input.value = "";
  input.focus();
}

// 快捷操作功能
function useQuickAction(action) {
  const input = document.getElementById("scriptInput");
  let prompt = "";

  switch (action) {
    case "增加更多专业解释":
      prompt =
        "请在剧本中增加更多专业解释，包括相关医学原理、科学依据等，但保持通俗易懂。";
      break;
    case "添加实际案例":
      prompt =
        "请在剧本中添加一些实际案例或真实故事，使内容更有说服力和代入感。";
      break;
    case "增加互动环节":
      prompt =
        "请在剧本中增加一些互动环节，如问答、小游戏或实践指导，让观众能够参与其中。";
      break;
    case "加入趣味元素":
      prompt =
        "请在剧本中加入一些趣味元素，如比喻、类比或幽默表达，使内容更加生动有趣。";
      break;
  }

  input.value = prompt;
  sendScriptMessage();
}

// 版本历史管理
let scriptVersions = [];

function saveVersion(content) {
  const timestamp = new Date().toLocaleString();
  scriptVersions.push({
    timestamp,
    content,
  });
  updateVersionHistory();
}

function updateVersionHistory() {
  const historyDiv = document.getElementById("versionHistory");
  const versionCount = document.getElementById("versionCount");

  versionCount.textContent = `${scriptVersions.length} 个版本`;

  historyDiv.innerHTML = scriptVersions
    .map(
      (version, index) => `
        <div class="mb-2 d-flex align-items-center gap-2">
            <button class="btn btn-sm ${
              index === scriptVersions.length - 1
                ? "btn-primary"
                : "btn-outline-primary"
            } flex-grow-1" 
                onclick="loadVersion(${index})">
                <i class="fas fa-history"></i> 版本 ${index + 1}
                <br>
                <small>${version.timestamp}</small>
            </button>
            <button class="btn btn-sm btn-outline-success" onclick="downloadVersion(${index})">
                <i class="fas fa-download"></i>
            </button>
        </div>
    `
    )
    .join("");
}

function showVersionHistory() {
  if (scriptVersions.length === 0) {
    addMessage("ai", "暂无历史版本");
    return;
  }

  addMessage(
    "ai",
    `当前共有 ${scriptVersions.length} 个版本，您可以在右侧版本历史区域查看和切换。`
  );
}

function loadVersion(index) {
  const version = scriptVersions[index];
  generationState.currentScript = version.content;
  addMessage("system", `已切换到版本 ${index + 1}`);
  addMessage("ai", version.content, true);
}

// 下载功能
function downloadScript() {
  if (!generationState.currentScript) {
    showError(new Error("没有可下载的剧本"));
    return;
  }

  const blob = new Blob([generationState.currentScript], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `健康科普剧本_${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadVersion(index) {
  const version = scriptVersions[index];
  if (!version) {
    showError(new Error("找不到指定版本"));
    return;
  }

  const blob = new Blob([version.content], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `健康科普剧本_版本${index + 1}_${version.timestamp.replace(
    /[/:]/g,
    "-"
  )}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 清除工作区功能
function clearWorkspace() {
  if (confirm("确定要清除所有内容和历史版本吗？此操作不可撤销。")) {
    // 清空对话区域
    clearChat();

    // 重置版本历史
    scriptVersions = [];
    updateVersionHistory();

    // 重置生成状态
    generationState = {
      stage: "initial",
      content: "",
      selectedOutline: null,
      selectedDirection: null,
      currentScript: "",
    };

    // 隐藏快捷操作按钮
    document.getElementById("quickActions").style.display = "none";

    // 隐藏分析按钮
    document.getElementById("analysisBtn").style.display = "none";

    // 添加初始提示消息
    const scriptWorkspace = document.getElementById("scriptWorkspace");
    scriptWorkspace.innerHTML = `
            <div class="text-center text-muted">
                <i class="fas fa-heartbeat fa-2x mb-2"></i>
                <p>请输入健康相关的主题，我将帮您生成科普剧本</p>
            </div>
        `;

    // 清空输入框
    document.getElementById("scriptInput").value = "";
    document.getElementById("scriptInput").disabled = true;
    document.getElementById("sendButton").disabled = true;
    document.getElementById("novelInput").value = "";
    document.getElementById("novelFile").value = "";

    // 清空关键词
    healthKeywords = [];
    updateKeywordsDisplay();

    // 清空分析数据
    clearAnalysisData();
  }
}

// ===================
// 剧本分析功能
// ===================

let analysisData = {
  flowchart: [],
  terminology: [],
  stats: {
    wordCount: 0,
    sceneCount: 0,
    characterCount: 0,
    termCount: 0,
  },
};

// 跳转到分析页面
function goToAnalysis() {
  if (!generationState.currentScript) {
    alert("请先生成剧本");
    return;
  }

  // 分析剧本
  analyzeScript(generationState.currentScript);

  // 切换到分析页面
  showPage("analysis");
}

// 分析剧本内容
async function analyzeScript(script) {
  try {
    // 显示加载状态
    showAnalysisLoading();

    // 并行处理多个分析任务
    await Promise.all([
      generateFlowchart(script),
      extractTerminology(script),
      generateStats(script),
    ]);

    // 更新UI显示
    updateAnalysisDisplay();
  } catch (error) {
    console.error("分析失败:", error);
    showAnalysisError(error);
  }
}

// 生成流程图
async function generateFlowchart(script) {
  try {
    const messages = [
      { role: "system", content: PROMPTS.FLOWCHART_ANALYSIS },
      { role: "user", content: script },
    ];

    const response = await callAPI(messages);
    const flowchart = parseFlowchartResponse(response);

    analysisData.flowchart = flowchart;
  } catch (error) {
    console.error("流程图生成失败:", error);
    // 生成默认流程图
    analysisData.flowchart = generateDefaultFlowchart(script);
  }
}

// 解析流程图响应
function parseFlowchartResponse(response) {
  try {
    const cleanResponse = response.replace(/```json\s*|\s*```/g, "").trim();
    const parsed = JSON.parse(cleanResponse);
    if (parsed.flowchart && Array.isArray(parsed.flowchart)) {
      return parsed.flowchart;
    }
  } catch (e) {
    // JSON解析失败，尝试文本解析
  }

  // 文本解析方式
  const flowchart = [];
  const lines = response.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^(\d+[\.、]|\*|\-)\s*(.+)/);
    if (match && match[2].length > 3) {
      const content = match[2].replace(/[\*\#]/g, "").trim();
      flowchart.push({
        title: content.length > 20 ? content.substring(0, 20) + "..." : content,
        description: content,
        type: determineNodeType(flowchart.length),
      });
    }
  }

  return flowchart.length > 0 ? flowchart : generateDefaultFlowchart();
}

// 确定节点类型
function determineNodeType(index) {
  if (index === 0) return "start";
  if (index <= 2) return "development";
  return index === 3 ? "climax" : "ending";
}

// 生成默认流程图
function generateDefaultFlowchart(script = "") {
  const scenes = script
    .split(/场景|第[一二三四五六七八九十\d]+幕|第[一二三四五六七八九十\d]+场/)
    .filter((s) => s.trim());

  if (scenes.length > 1) {
    return scenes.slice(0, 5).map((scene, index) => ({
      title: `场景 ${index + 1}`,
      description: scene.substring(0, 100).trim() + "...",
      type: determineNodeType(index),
    }));
  }

  return [
    {
      title: "开场引入",
      description: "引出健康话题，吸引观众注意",
      type: "start",
    },
    {
      title: "问题展示",
      description: "展示健康问题的严重性",
      type: "development",
    },
    {
      title: "专业解答",
      description: "提供专业的健康知识和建议",
      type: "climax",
    },
    {
      title: "实践指导",
      description: "给出具体的行动建议",
      type: "development",
    },
    {
      title: "总结呼吁",
      description: "总结要点，呼吁健康行动",
      type: "ending",
    },
  ];
}

// 提取专业词汇
async function extractTerminology(script) {
  try {
    const messages = [
      { role: "system", content: PROMPTS.TERMINOLOGY_EXTRACTION },
      { role: "user", content: script },
    ];

    const response = await callAPI(messages);
    const terminology = parseTerminologyResponse(response);

    analysisData.terminology = terminology;
  } catch (error) {
    console.error("专业词汇提取失败:", error);
    // 生成默认词汇
    analysisData.terminology = extractDefaultTerminology(script);
  }
}

// 解析专业词汇响应
function parseTerminologyResponse(response) {
  try {
    const cleanResponse = response.replace(/```json\s*|\s*```/g, "").trim();
    const parsed = JSON.parse(cleanResponse);
    if (parsed.terminology && Array.isArray(parsed.terminology)) {
      return parsed.terminology;
    }
  } catch (e) {
    // JSON解析失败，尝试文本解析
  }

  // 文本解析方式
  const terminology = [];
  const lines = response.split("\n");
  let currentTerm = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // 检测专业词汇标题
    const termMatch = trimmed.match(
      /^(\d+[\.、]|\*|\-)\s*([^：:]+)[:：]\s*(.+)/
    );
    if (termMatch) {
      if (currentTerm) {
        terminology.push(currentTerm);
      }
      currentTerm = {
        term: termMatch[2].trim(),
        description: termMatch[3].trim(),
        frequency: Math.floor(Math.random() * 5) + 1,
      };
    } else if (
      currentTerm &&
      trimmed.length > 0 &&
      !trimmed.match(/^[\d\*\-]/)
    ) {
      currentTerm.description += " " + trimmed;
    }
  }

  if (currentTerm) {
    terminology.push(currentTerm);
  }

  return terminology;
}

// 提取默认专业词汇
function extractDefaultTerminology(script) {
  const medicalTerms = [
    "预防保健",
    "营养均衡",
    "慢性病",
    "免疫力",
    "维生素",
    "矿物质",
    "蛋白质",
    "碳水化合物",
    "膳食纤维",
    "抗氧化剂",
    "血压",
    "血糖",
    "胆固醇",
    "心血管",
    "呼吸系统",
  ];

  const foundTerms = [];

  medicalTerms.forEach((term) => {
    const regex = new RegExp(term, "gi");
    const matches = script.match(regex);
    if (matches) {
      foundTerms.push({
        term: term,
        description: `${term}相关的健康知识，建议查阅专业资料了解更多详情。`,
        frequency: matches.length,
      });
    }
  });

  return foundTerms.sort((a, b) => b.frequency - a.frequency).slice(0, 10);
}

// 生成统计信息
function generateStats(script) {
  const wordCount = script.replace(/\s/g, "").length;
  const sceneCount = (
    script.match(
      /场景|第[一二三四五六七八九十\d]+幕|第[一二三四五六七八九十\d]+场/g
    ) || []
  ).length;
  const characterCount = (script.match(/[A-Za-z\u4e00-\u9fa5]+：/g) || [])
    .length;

  analysisData.stats = {
    wordCount,
    sceneCount: Math.max(sceneCount, 1),
    characterCount: Math.max(characterCount, 2),
    termCount: analysisData.terminology.length,
  };
}

// 显示分析加载状态
function showAnalysisLoading() {
  const flowchartContainer = document.getElementById("flowchartContainer");
  const terminologyContainer = document.getElementById("terminologyContainer");

  flowchartContainer.innerHTML = `
    <div class="text-center py-5">
      <div class="spinner-border text-primary mb-3" role="status"></div>
      <h6>正在分析剧本结构...</h6>
      <p class="text-muted small">请稍候，这可能需要几秒钟时间</p>
    </div>
  `;

  terminologyContainer.innerHTML = `
    <div class="text-center py-5">
      <div class="spinner-border text-primary mb-3" role="status"></div>
      <h6>正在提取专业词汇...</h6>
      <p class="text-muted small">正在识别健康相关术语</p>
    </div>
  `;
}

// 显示分析错误
function showAnalysisError(error) {
  const flowchartContainer = document.getElementById("flowchartContainer");
  flowchartContainer.innerHTML = `
    <div class="text-center py-5">
      <i class="fas fa-exclamation-triangle fa-2x text-warning mb-3"></i>
      <h6>分析过程中出现问题</h6>
      <p class="text-muted small">${error.message}</p>
      <button class="btn btn-primary btn-sm" onclick="goToAnalysis()">
        <i class="fas fa-redo"></i> 重新分析
      </button>
    </div>
  `;
}

// 更新分析显示
function updateAnalysisDisplay() {
  updateFlowchartDisplay();
  updateTerminologyDisplay();
  updateStatsDisplay();
}

// 更新流程图显示
function updateFlowchartDisplay() {
  const container = document.getElementById("flowchartContainer");

  if (analysisData.flowchart.length === 0) {
    container.innerHTML = `
      <div class="text-center py-5">
        <i class="fas fa-exclamation-circle fa-2x text-muted mb-3"></i>
        <h6>无法生成流程图</h6>
        <p class="text-muted small">剧本结构不够清晰</p>
      </div>
    `;
    return;
  }

  let html = '<div class="flowchart-display">';

  analysisData.flowchart.forEach((node, index) => {
    if (index > 0) {
      html += `
        <div class="flowchart-row">
          <i class="fas fa-arrow-down flowchart-arrow"></i>
        </div>
      `;
    }

    html += `
      <div class="flowchart-row">
        <div class="flowchart-node ${node.type}" title="${node.description}">
          <strong>${node.title}</strong>
          <div class="small mt-1" style="opacity: 0.9;">
            ${
              node.description.length > 50
                ? node.description.substring(0, 50) + "..."
                : node.description
            }
          </div>
        </div>
      </div>
    `;
  });

  html += "</div>";
  container.innerHTML = html;
}

// 更新专业词汇显示
function updateTerminologyDisplay() {
  const container = document.getElementById("terminologyContainer");

  if (analysisData.terminology.length === 0) {
    container.innerHTML = `
      <div class="text-center py-5">
        <i class="fas fa-book fa-2x text-muted mb-3"></i>
        <h6>未发现专业词汇</h6>
        <p class="text-muted small">剧本中没有识别到专业术语</p>
      </div>
    `;
    return;
  }

  const html = analysisData.terminology
    .map(
      (term, index) => `
    <div class="terminology-item">
      <div class="terminology-header" onclick="toggleTerminology(${index})">
        <div class="d-flex align-items-center">
          <span class="terminology-term">${term.term}</span>
          <span class="terminology-frequency">${term.frequency}</span>
        </div>
        <div class="terminology-actions">
          <a href="https://www.baidu.com/s?wd=${encodeURIComponent(
            term.term
          )}%20医学%20健康" 
             target="_blank" 
             class="search-btn"
             onclick="event.stopPropagation()">
            <i class="fas fa-search"></i> 搜索
          </a>
          <i class="fas fa-chevron-down ms-2" id="arrow-${index}"></i>
        </div>
      </div>
      <div class="terminology-content" id="content-${index}" style="display: none;">
        <div class="terminology-description">${term.description}</div>
        <div class="d-flex gap-2 flex-wrap">
          <a href="https://www.baidu.com/s?wd=${encodeURIComponent(
            term.term
          )}%20医学%20定义" 
             target="_blank" 
             class="search-btn btn-sm">
            <i class="fas fa-book-medical"></i> 医学定义
          </a>
          <a href="https://www.baidu.com/s?wd=${encodeURIComponent(
            term.term
          )}%20健康%20科普" 
             target="_blank" 
             class="search-btn btn-sm">
            <i class="fas fa-heart"></i> 健康科普
          </a>
          <a href="https://www.baidu.com/s?wd=${encodeURIComponent(
            term.term
          )}%20预防%20治疗" 
             target="_blank" 
             class="search-btn btn-sm">
            <i class="fas fa-shield-alt"></i> 预防治疗
          </a>
        </div>
      </div>
    </div>
  `
    )
    .join("");

  container.innerHTML = html;
}

// 切换专业词汇详情显示
function toggleTerminology(index) {
  const content = document.getElementById(`content-${index}`);
  const arrow = document.getElementById(`arrow-${index}`);

  if (content.style.display === "none") {
    content.style.display = "block";
    arrow.className = "fas fa-chevron-up ms-2";
  } else {
    content.style.display = "none";
    arrow.className = "fas fa-chevron-down ms-2";
  }
}

// 更新统计信息显示
function updateStatsDisplay() {
  const statsContainer = document.getElementById("statsContainer");
  statsContainer.style.display = "block";

  document.getElementById("wordCount").textContent =
    analysisData.stats.wordCount.toLocaleString();
  document.getElementById("sceneCount").textContent =
    analysisData.stats.sceneCount;
  document.getElementById("characterCount").textContent =
    analysisData.stats.characterCount;
  document.getElementById("termCount").textContent =
    analysisData.stats.termCount;
}

// 导出流程图
function exportFlowchart() {
  if (analysisData.flowchart.length === 0) {
    alert("没有可导出的流程图数据");
    return;
  }

  let content = "健康科普剧本流程图\n";
  content += "=" * 30 + "\n\n";

  analysisData.flowchart.forEach((node, index) => {
    content += `${index + 1}. ${node.title}\n`;
    content += `   ${node.description}\n\n`;
  });

  content += "\n统计信息：\n";
  content += `总字数：${analysisData.stats.wordCount}\n`;
  content += `场景数：${analysisData.stats.sceneCount}\n`;
  content += `角色数：${analysisData.stats.characterCount}\n`;
  content += `专业词汇：${analysisData.stats.termCount}\n`;

  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `剧本流程图_${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 导出专业词汇
function exportTerminology() {
  if (analysisData.terminology.length === 0) {
    alert("没有可导出的专业词汇数据");
    return;
  }

  let content = "健康科普剧本专业词汇解析\n";
  content += "=" * 40 + "\n\n";

  analysisData.terminology.forEach((term, index) => {
    content += `${index + 1}. ${term.term} (出现${term.frequency}次)\n`;
    content += `   ${term.description}\n`;
    content += `   搜索链接：https://www.baidu.com/s?wd=${encodeURIComponent(
      term.term
    )}%20医学%20健康\n\n`;
  });

  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `专业词汇解析_${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 清空分析数据
function clearAnalysisData() {
  analysisData = {
    flowchart: [],
    terminology: [],
    stats: {
      wordCount: 0,
      sceneCount: 0,
      characterCount: 0,
      termCount: 0,
    },
  };

  // 重置分析页面显示
  const flowchartContainer = document.getElementById("flowchartContainer");
  const terminologyContainer = document.getElementById("terminologyContainer");
  const statsContainer = document.getElementById("statsContainer");

  if (flowchartContainer) {
    flowchartContainer.innerHTML = `
      <div class="text-center text-muted py-5">
        <i class="fas fa-exclamation-circle fa-2x mb-3"></i>
        <h6>暂无剧本数据</h6>
        <p class="mb-0">请先在工作区生成剧本</p>
        <button class="btn btn-primary mt-3" onclick="showPage('workspace')">
          <i class="fas fa-arrow-left me-2"></i>返回工作区
        </button>
      </div>
    `;
  }

  if (terminologyContainer) {
    terminologyContainer.innerHTML = `
      <div class="text-center text-muted py-5">
        <i class="fas fa-book fa-2x mb-3"></i>
        <h6>暂无专业词汇</h6>
        <p class="mb-0 small">剧本生成后将自动提取专业词汇</p>
      </div>
    `;
  }

  if (statsContainer) {
    statsContainer.style.display = "none";
  }
}

// 添加样式
const style = document.createElement("style");
style.textContent = `
    /* 标题样式 */
    .site-title {
        font-family: 'Segoe UI', Arial, sans-serif;
        font-size: 2.5rem;
        font-weight: bold;
        color: #2c3e50;
        text-align: center;
        margin: 1rem 0;
        padding: 0.5rem;
        position: relative;
        text-shadow: 2px 2px 4px rgba(0,0,0,0.1);
    }
    
    .site-title::before {
        content: "✨";
        position: absolute;
        left: -30px;
        top: 50%;
        transform: translateY(-50%);
    }
    
    .site-title::after {
        content: "✨";
        position: absolute;
        right: -30px;
        top: 50%;
        transform: translateY(-50%);
    }
    
    .site-subtitle {
        font-size: 1rem;
        color: #7f8c8d;
        text-align: center;
        margin-bottom: 2rem;
    }

    /* 选择按钮样式 */
    .choice-container {
        width: 100%;
    }
    
    .choice-btn {
        transition: all 0.3s ease;
        border-radius: 8px;
        margin-bottom: 8px;
    }
    
    .choice-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    
    .choice-btn .badge {
        font-size: 0.8em;
    }

    /* 原有样式保持不变 */
    .message {
        border-radius: 15px;
        margin: 5px 0;
    }
    .message.user {
        border-top-right-radius: 5px;
    }
    .message.ai {
        border-top-left-radius: 5px;
    }
    .chat-window {
        background: #f8f9fa;
    }
    .version-history button {
        width: 100%;
        text-align: left;
    }
    .chat-input-area {
        position: relative;
    }
    .quick-actions .btn {
        margin-right: 5px;
        margin-bottom: 5px;
    }
    .chat-window::-webkit-scrollbar {
        width: 8px;
    }
    .chat-window::-webkit-scrollbar-track {
        background: #f1f1f1;
    }
    .chat-window::-webkit-scrollbar-thumb {
        background: #888;
        border-radius: 4px;
    }
    .chat-window::-webkit-scrollbar-thumb:hover {
        background: #555;
    }
    .alert {
        animation: fadeIn 0.3s ease-in-out;
    }
    .alert-danger {
        border-left: 4px solid #dc3545;
    }
    .alert i {
        color: #dc3545;
        font-size: 1.2em;
    }
    @keyframes fadeIn {
        from {
            opacity: 0;
            transform: translateY(-10px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    
    /* 添加渐变背景和动画效果 */
    @keyframes gradientBG {
        0% {
            background-position: 0% 50%;
        }
        50% {
            background-position: 100% 50%;
        }
        100% {
            background-position: 0% 50%;
        }
    }
    
    .gradient-bg {
        background: linear-gradient(-45deg, #ee7752, #e73c7e, #23a6d5, #23d5ab);
        background-size: 400% 400%;
        animation: gradientBG 15s ease infinite;
        height: 5px;
        margin-bottom: 1rem;
    }
`;
document.head.appendChild(style);
