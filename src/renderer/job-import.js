'use strict';

// ============================================================
//  粘贴导入：把从招聘网站复制出来的文本，在本机解析成投递记录
//
//  为什么是「粘贴」而不是「抓取」：
//    抓取招聘网站要绕过反爬（签名/滑块/设备指纹），既有法律风险，
//    也会把用户的真实求职账号置于封号风险中 —— 而这个应用的意义正是保住用户的投递数据。
//    粘贴是用户自己把内容交进来，动作发生在用户自己的浏览器里，本模块**完全不联网**。
//
//  设计原则（与全局一致）：
//    - 认不出就说认不出，绝不编造公司名/岗位名
//    - 每个字段都标注来源（明确写的 vs 推断的），界面上区分显示
//    - 批量导入必须走「预览 + 勾选 + 可编辑」，不静默写入
// ============================================================
(function () {
  const UI = window.UI;
  const el = UI.el;

  // ---------------- 词表 ----------------
  // 岗位关键词：用于在一堆行里判断「哪一行最像岗位名」
  const TITLE_WORDS = /(工程师|开发|架构师|程序员|算法|测试|运维|前端|后端|全栈|数据|产品经理|产品|运营|市场|销售|客户经理|财务|会计|审计|税务|出纳|风控|投资|研究|研究员|分析|咨询|顾问|法务|人事|招聘|行政|助理|专员|主管|经理|总监|设计师|设计|编辑|记者|策划|文案|教师|讲师|培训|医生|护士|药剂|翻译|采购|供应链|物流|质量管理|工艺|机械|电气|自动化|土木|结构|建造|造价|安全员|施工|监理|店长|客服|导游|律师|柜员|实习生|管培生|储备干部|应届生|博士|硕士)/;
  // 公司后缀：判断一行是不是公司名
  const COMPANY_WORDS = /(有限公司|有限责任公司|股份有限公司|股份公司|集团|公司|银行|证券|保险|基金|事务所|研究院|研究所|设计院|大学|学院|医院|传媒|工作室|工厂|支行|分行)/;
  const EDU_WORDS = /^(学历)?[:：]?\s*(不限|大专|专科|本科|统招本科|硕士|研究生|博士|高中|中专|初中|MBA)\s*(及以上|以上)?$/;
  const EXP_WORDS = /^(经验)?[:：]?\s*(经验不限|不限经验|应届生?|在校生?|实习|无经验|\d+\s*[-–~至]?\s*\d*\s*年(以上)?(经验)?|\d+\s*年以内)$/;

  const PLATFORMS = [
    [/zhipin\.com/i, 'BOSS直聘'],
    [/zhaopin\.com/i, '智联招聘'],
    [/51job\.com|51job\.cn/i, '前程无忧'],
    [/liepin\.com/i, '猎聘'],
    [/shixiseng\.com/i, '实习僧'],
    [/lagou\.com/i, '拉勾'],
    [/nowcoder\.com/i, '牛客'],
    [/yingjiesheng\.com/i, '应届生求职网'],
    [/iguopin\.com/i, '国聘'],
    [/linkedin\.com/i, 'LinkedIn'],
    [/job\.mohrss\.gov\.cn/i, '中国公共招聘网']
  ];
  function platformOf(text) {
    for (const [re, name] of PLATFORMS) if (re.test(text)) return name;
    return '';
  }

  // ---------------- 单字段识别 ----------------
  const RE_URL = /https?:\/\/[^\s"'<>）)】]+/i;
  // 薪资：覆盖 15-25K / 1.5-2.5万 / 8千-1.2万 / 200-300元/天 / 20-30万/年 / 面议
  const RE_SALARY = /(\d+(?:\.\d+)?)\s*[-~－—至]\s*(\d+(?:\.\d+)?)\s*(万|千|[kK]|元)?(?:\s*[·・]\s*(\d+)\s*薪)?(?:\s*\/\s*(月|天|年))?|(\d+(?:\.\d+)?)\s*(万|千|[kK]|元)\s*\/\s*(月|天|年)|(薪资)?面议/;
  const RE_SALARY_LINE = new RegExp('^\\s*' + RE_SALARY.source + '\\s*$');

  function asSalary(line) {
    const m = line.match(RE_SALARY);
    if (!m) return '';
    return line.trim().slice(0, 24);
  }

  function lineKind(line, ctx) {
    const s = line.trim();
    if (!s) return 'blank';
    if (RE_URL.test(s) && s.length < 300) return 'url';
    if (RE_SALARY_LINE.test(s) && s.length <= 26) return 'salary';
    if (EDU_WORDS.test(s)) return 'education';
    if (EXP_WORDS.test(s)) return 'experience';
    if (/^市区|^[·•\-—\s]*$/.test(s)) return 'noise';
    // 公司名优先于地点：否则「北京某某科技有限公司」会被当成地点
    if (COMPANY_WORDS.test(s) && s.length <= 34 && !TITLE_WORDS.test(s.replace(/工程师|开发/g, ''))) return 'company';
    if (isLengthyProse(s)) return 'prose';
    if (window.Geo && window.Geo.parseLocation(s)) return 'location';
    return 'other';
  }

  // 大段 JD 正文（岗位职责/任职要求那类）不该被当成岗位名或公司名
  function isLengthyProse(s) {
    if (s.length < 26) return false;
    return /[。；;，,、]/.test(s) && !COMPANY_WORDS.test(s);
  }

  function explicitField(s, names) {
    for (const n of names) {
      const m = s.match(new RegExp('^\\s*' + n + '\\s*[:：]\\s*(.+)$'));
      if (m) return m[1].trim();
    }
    return '';
  }

  // ---------------- 单块解析 ----------------
  function parseBlock(block, fallbackUrl) {
    const raw = block.trim();
    if (!raw) return null;
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out = {
      company: '', position: '', place: '', city: '', salary: '', education: '', experience: '',
      url: fallbackUrl || '', platform: '', notes: [], level: {}
    };

    // 0) 分享格式：【岗位_城市-区_薪资】公司 - 平台
    const share = raw.match(/【([^】]{2,80})】\s*([^\n【】]{0,40})/);
    if (share) {
      const parts = share[1].split(/[_|｜]/).map((x) => x.trim()).filter(Boolean);
      const rest = share[2].replace(/^[-—\s]+/, '').trim();
      if (rest) { out.company = rest.replace(/[-—\s]*(BOSS直聘|智联招聘|前程无忧|猎聘|实习僧).*$/, '').trim(); out.level.company = 'explicit'; }
      parts.forEach((p) => {
        if (!out.position && TITLE_WORDS.test(p)) { out.position = p; out.level.position = 'explicit'; return; }
        if (!out.salary && RE_SALARY.test(p)) { out.salary = p; out.level.salary = 'explicit'; return; }
        const loc = window.Geo && window.Geo.parseLocation(p);
        if (loc && !out.place) {
          out.place = loc.label; out.city = loc.cityKey; out.level.place = 'explicit';
        }
      });
    }

    // 1) 逐行分类
    const buckets = { company: [], location: [], salary: [], url: [], other: [] };
    lines.forEach((l) => {
      const k = lineKind(l, out);
      if (k === 'company') buckets.company.push(l);
      else if (k === 'location') buckets.location.push(l);
      else if (k === 'salary') buckets.salary.push(l);
      else if (k === 'url') buckets.url.push(l);
      else if (k === 'other') buckets.other.push(l);
    });

    // 2) 显式前缀优先
    lines.forEach((l) => {
      const c = explicitField(l, ['公司', '公司名称', '企业', '招聘方', '用人单位']);
      if (c && !out.company) { out.company = c; out.level.company = 'explicit'; }
      const p = explicitField(l, ['岗位', '职位', '职位名称', '招聘岗位', '应聘职位']);
      if (p && !out.position) { out.position = p; out.level.position = 'explicit'; }
      const a = explicitField(l, ['地点', '工作地点', '地址', '所在城市']);
      if (a && !out.place) {
        const loc = window.Geo && window.Geo.parseLocation(a);
        if (loc) { out.place = loc.label; out.city = loc.cityKey; out.level.place = 'explicit'; }
      }
    });

    // 3) 链接与平台
    if (!out.url && buckets.url.length) out.url = (buckets.url[0].match(RE_URL) || [''])[0];
    out.platform = platformOf(out.url + ' ' + raw);

    // 4) 薪资 / 学历 / 经验
    if (!out.salary && buckets.salary.length) {
      out.salary = asSalary(buckets.salary[0]);
      if (out.salary) out.level.salary = 'inferred';
    }
    lines.forEach((l) => {
      if (!out.education && EDU_WORDS.test(l)) out.education = l.trim();
      const em = l.match(/(经验不限|不限经验|应届生?|在校生?|实习|\d+\s*[-–~至]?\s*\d*\s*年(?:以上)?(?:经验)?|\d+\s*年以内)/);
      if (!out.experience && em) out.experience = em[0].trim();
    });

    // 5) 地点：优先带区县的，其次城市级
    if (!out.place) {
      let best = null;
      buckets.location.concat(buckets.other).forEach((l) => {
        const loc = window.Geo && window.Geo.parseLocation(l);
        if (!loc) return;
        if (!best || (loc.level === 'district' && best.level !== 'district')) best = loc;
      });
      if (best) {
        out.place = best.label; out.city = best.cityKey; out.level.place = 'inferred';
      }
    }

    // 6) 公司名：后缀匹配；再退到链接标题/首行
    if (!out.company && buckets.company.length) {
      // 取最短的一条（越短越可能是纯粹的公司名，而不是「公司名 行业 规模」粘在一行）
      const pick = buckets.company.slice().sort((a, b) => a.length - b.length)[0];
      out.company = pick.replace(/\s*(互联网|电子商务|计算机软件|企业服务|金融|教育|医疗|制造|新能源|人工智能|大数据|游戏|物流|消费生活|电子商务).*$/, '').trim().slice(0, 40);
      out.level.company = buckets.company.length === 1 ? 'inferred' : 'guessed';
    }

    // 7) 岗位名：关键词行 > 薪资行前一行
    if (!out.position) {
      const titled = buckets.other.filter((l) => TITLE_WORDS.test(l) && l.length <= 26 && !/[。；;，,、]/.test(l));
      if (titled.length) {
        out.position = titled[0];
        out.level.position = titled.length === 1 ? 'inferred' : 'guessed';
      }
    }
    if (!out.position) {
      const si = lines.findIndex((l) => RE_SALARY_LINE.test(l));
      if (si > 0 && lines[si - 1].length <= 26) {
        out.position = lines[si - 1];
        out.level.position = 'guessed';
      }
    }

    // 8) 兜底：整块第一行当作岗位名（很多平台的卡片就是「岗位名 / 薪资 / 地点」顺序）
    //    但必须还有别的识别信号：否则随便一段文字都会被当成岗位名，就成了「编造」
    if (!out.position && lines.length) {
      const first = lines[0].replace(/^【|】$/g, '').trim();
      const hasOtherSignal = !!(out.salary || out.place || out.company || out.url);
      if (first.length >= 2 && first.length <= 30 && !RE_URL.test(first) && !COMPANY_WORDS.test(first) &&
          (TITLE_WORDS.test(first) || hasOtherSignal)) {
        out.position = first;
        out.level.position = 'guessed';
      }
    }

    // 9) 诚实标注：哪些是猜的 / 缺了什么
    if (out.level.company === 'guessed' || !out.company) out.notes.push('公司名是推断的，请核对');
    if (out.level.position === 'guessed' || !out.position) out.notes.push('岗位名是推断的，请核对');
    if (!out.place) out.notes.push('没认出工作地点（填上才能算距离）');
    if (!out.company && !out.position) return null;
    return out;
  }

  /** 解析整段粘贴文本 → 候选列表。多岗位时按空行/链接切块 */
  function parse(text) {
    const rawText = String(text == null ? '' : text);
    if (!rawText.trim()) return { candidates: [], warning: '没有内容' };

    // 切块：先按空行切；没有空行时，只有**确实存在 2 个以上链接**才按链接切。
    // 一开始写成「看到链接就切」，结果把最常见的「分享文案 + 下一行链接」拆成两块，
    // 链接落进第二块（那块没有岗位/公司信息，被丢掉），于是平台和链接全丢 —— 测试抓到了这个。
    let blocks = rawText.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean);
    if (blocks.length === 1) {
      const urlCount = (rawText.match(/https?:\/\//g) || []).length;
      if (urlCount >= 2) {
        const byUrl = rawText.split(/(?=https?:\/\/(?:www\.)?(?:zhipin|zhaopin|51job|liepin|shixiseng|lagou|nowcoder|yingjiesheng|iguopin)\.)/i)
          .map((b) => b.trim()).filter(Boolean);
        if (byUrl.length > 1) blocks = byUrl;
      }
    }

    const candidates = [];
    blocks.forEach((b) => {
      const c = parseBlock(b, '');
      if (c) candidates.push(c);
    });
    // 整段粘成一块（详情页那种）且没解析出东西时的兜底
    if (!candidates.length) {
      const c = parseBlock(rawText, '');
      if (c) candidates.push(c);
    }
    const warning = candidates.length === 0
      ? '没认出任何岗位。建议把招聘页上的「岗位名 / 薪资 / 城市·区 / 公司名」一起复制进来。'
      : '';
    return { candidates: candidates, warning: warning };
  }

  // ---------------- 预览 + 导入界面 ----------------
  // 来源标记 → 界面文案（推断与明确写出来的区分显示，不让用户误以为都是原文）
  const LEVEL_TEXT = { explicit: '原文', inferred: '识别', guessed: '推断', manual: '手填' };

  async function openImportDialog(ctx) {
    const text = await UI.modalTextarea('粘贴导入投递记录', {
      rows: 10,
      placeholder: '把招聘网站上的岗位信息复制粘贴到这里（岗位名、薪资、城市、公司名一起复制最好）。\n支持一次粘贴多条：用空行隔开，或每条带各自的链接。\n\n例：\nJava开发工程师\n15-25K\n北京·朝阳区\n某某科技有限公司'
    });
    if (!text || !text.trim()) return;

    const res = parse(text);
    if (!res.candidates.length) { UI.toast(res.warning || '没认出可导入的内容', 'err'); return null; }
    const picked = await showPreview(res.candidates, ctx);
    if (!picked) return null;
    const stat = await importCandidates(picked, ctx);
    UI.toast('导入完成：新增 ' + stat.added + ' 条' + (stat.updated ? ' / 更新 ' + stat.updated + ' 条' : ''), 'ok');
    if (ctx.onChanged) await ctx.onChanged();
    return stat;
  }

  function showPreview(candidates, ctx) {
    return new Promise((resolve) => {
      const items = candidates.map((c, i) => {
        const box = el('input', { type: 'checkbox' });
        box.checked = true;
        const inputs = {};
        const field = (label, key) => {
          const input = el('input', { class: 'ji-input', value: c[key] || '', placeholder: label });
          inputs[key] = input;
          return el('label', { class: 'ji-field' }, [
            el('span', { class: 'ji-label' }, [
              label,
              c.level[key] ? el('i', { class: 'ji-src ji-src-' + c.level[key] }, [LEVEL_TEXT[c.level[key]] || '']) : null
            ]),
            input
          ]);
        };
        const notes = c.notes.length
          ? el('div', { class: 'ji-notes' }, c.notes.map((n) => el('span', {}, ['⚠ ' + n])))
          : el('div', { class: 'ji-notes ok' }, ['✓ 关键字段都识别到了']);
        const node = el('div', { class: 'ji-row' }, [
          el('label', { class: 'ji-check' }, [box]),
          el('div', { class: 'ji-body' }, [
            el('div', { class: 'ji-top' }, [
              el('b', {}, ['#' + (i + 1)]),
              c.platform ? el('span', { class: 'ji-platform' }, [c.platform]) : null,
              c.salary ? el('span', { class: 'ji-salary' }, [c.salary]) : null,
              c.education ? el('span', { class: 'ji-tag' }, [c.education]) : null,
              c.experience ? el('span', { class: 'ji-tag' }, [c.experience]) : null,
              c.url ? el('span', { class: 'ji-tag' }, ['含链接']) : null
            ]),
            el('div', { class: 'ji-grid' }, [
              field('公司名称', 'company'),
              field('岗位名称', 'position'),
              field('公司所在地', 'place'),
              field('薪资', 'salary')
            ]),
            notes
          ])
        ]);
        return { node: node, box: box, inputs: inputs, raw: c };
      });
      const nodes = items.map((x) => x.node);

      const overlay = el('div', { class: 'modal-overlay' });
      const submit = el('button', { class: 'btn btn-primary', type: 'button' }, ['导入选中的 ' + items.length + ' 条']);
      const cancel = el('button', { class: 'btn btn-ghost', type: 'button' }, ['取消']);
      // 与同步预览一致：取消勾选后按钮计数实时变化，0 条时禁用
      const refreshSubmit = () => {
        const n = items.filter((x) => x.box.checked).length;
        submit.textContent = '导入选中的 ' + n + ' 条';
        submit.disabled = n === 0;
      };
      items.forEach((x) => x.box.addEventListener('change', refreshSubmit));
      refreshSubmit();
      function close(v) { overlay.remove(); resolve(v); }
      cancel.addEventListener('click', () => close(null));
      submit.addEventListener('click', () => {
        const picked = items.filter((x) => x.box.checked).map((x) => ({
          company: x.inputs.company.value.trim(),
          position: x.inputs.position.value.trim(),
          place: x.inputs.place.value.trim(),
          salary: x.raw.salary,
          url: x.raw.url,
          platform: x.raw.platform,
          education: x.raw.education,
          experience: x.raw.experience
        })).filter((x) => x.company || x.position);
        if (!picked.length) { UI.toast('一条都没选（公司名或岗位名至少要有一个）', 'err'); return; }
        close(picked);
      });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });

      const box = el('div', { class: 'modal-box ji-box' }, [
        el('h3', { class: 'modal-title' }, ['识别到 ' + candidates.length + ' 条，确认后导入']),
        el('p', { class: 'ji-hint' }, ['内容全部在你自己机器上解析，不联网。带「推断」标记的是猜的，请顺手核对一下；地点填对才能算距离。']),
        el('div', { class: 'ji-list' }, nodes),
        el('div', { class: 'modal-actions' }, [cancel, submit])
      ]);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      submit.focus();
    });
  }

  /** 导入：去重（同公司+同岗位视为同一条，更新而不是新增），返回统计 */
  async function importCandidates(list, ctx) {
    const existing = (ctx.applications || []);
    let added = 0, updated = 0;
    for (const c of list) {
      const company = c.company || '(未填公司)';
      const normalized = (v) => String(v || '').toLowerCase().replace(/[\s·•，,。.!！？:：()（）\[\]【】_-]+/g, '');
      const hit = existing.find((a) => (a.externalId && c.externalId && a.externalId === c.externalId && a.source === c.platform) ||
        (normalized(a.company) === normalized(company) && normalized(a.position) === normalized(c.position)));
      const patch = {
        company: company,
        position: c.position || '',
        // 与平台同步一致：新解析到的值优先，但为空时保留用户已填的内容；
        // 阶段只进不退，不把用户推进到「面试中」的记录拉回「已投递」
        place: c.place || (hit ? hit.place || '' : ''),
        url: c.url || (hit ? hit.url || '' : ''),
        stage: hit ? (hit.stage || 'applied') : 'applied'
      };
      // 解析到的补充信息写进备注，不丢；但用户自己写过的备注优先保留
      const extra = [];
      if (c.salary) extra.push('薪资：' + c.salary);
      if (c.platform) extra.push('来源：' + c.platform);
      if (c.education) extra.push('学历：' + c.education);
      if (c.experience) extra.push('经验：' + c.experience);
      if (extra.length && !(hit && hit.notes && String(hit.notes).trim())) patch.notes = extra.join(' · ');
      if (hit) { patch.id = hit.id; updated++; } else { added++; }
      const saved = await UI.call(window.api.applications.save(ctx.userId, patch));
      if (hit) {
        const i = existing.findIndex((a) => a.id === hit.id);
        if (i >= 0) existing[i] = saved; else existing.push(saved);
      } else {
        existing.unshift(saved);
      }
    }
    return { added: added, updated: updated };
  }

  window.JobImport = {
    parse: parse,
    openImportDialog: openImportDialog,
    importCandidates: importCandidates,
    // 供测试用
    _internal: { lineKind: lineKind, parseBlock: parseBlock, platformOf: platformOf, RE_SALARY: RE_SALARY }
  };
})();
