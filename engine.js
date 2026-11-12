// engine.js v1.7 - 2026-11-12 09:00 WIB (v1.7: model lookup chain: workflow, author notes, catalogue, community list, searches; size + format) (v1.6: model searches use the first words of the file name + web search link) (v1.5: Civitai search link uses civitai.red) (v1.4: MiniMax H3 family) (v1.3: matches packs by the Manager nodename_pattern, e.g. rgthree) (v1.2: loop check follows cables through subgraphs port by port) (v1.1: fuzzy + prefix custom node detective, live catalogue update)
// Workflow parsing + static analysis for the ComfyUI Workflow Checker. No DOM access in this file.
(function (root) {
  'use strict';
  var D = root.COMFY_DATA || { core: {}, packs: [], nodeMap: {}, patterns: [], models: {}, coreVersion: '?' };
  var FRONTEND = { Note: 1, MarkdownNote: 1, PrimitiveNode: 1, Reroute: 1 };
  var WTYPES = { INT: 1, FLOAT: 1, STRING: 1, BOOLEAN: 1, COMBO: 1, SAMPLERS: 1, SCHEDULERS: 1 };
  var SOCKETS = { MODEL: 1, CLIP: 1, VAE: 1, CONDITIONING: 1, LATENT: 1, IMAGE: 1, MASK: 1, CONTROL_NET: 1, CLIP_VISION: 1,
    CLIP_VISION_OUTPUT: 1, STYLE_MODEL: 1, UPSCALE_MODEL: 1, SAMPLER: 1, SIGMAS: 1, NOISE: 1, GUIDER: 1, AUDIO: 1, VIDEO: 1, GLIGEN: 1 };
  var MODEL_EXT = /\.(safetensors|sft|ckpt|pt|pth|bin|gguf|onnx)$/i;
  var CAT_LABEL = { checkpoints: 'Checkpoint', diffusion_models: 'Diffusion model', unet: 'Diffusion model', text_encoders: 'Text encoder',
    clip: 'Text encoder', vae: 'VAE', loras: 'LoRA', controlnet: 'ControlNet', upscale_models: 'Upscale model', clip_vision: 'CLIP Vision',
    style_models: 'Style model', embeddings: 'Embedding', vae_approx: 'Preview VAE (TAESD)', model_patches: 'Model patch',
    latent_upscale_models: 'Latent upscale model', audio_encoders: 'Audio encoder', ipadapter: 'IP-Adapter', sams: 'Segment Anything',
    ultralytics: 'Detector (Ultralytics)', hypernetworks: 'Hypernetwork', gligen: 'GLIGEN', photomaker: 'PhotoMaker',
    animatediff_models: 'AnimateDiff motion model', insightface: 'InsightFace', frame_interpolation: 'Frame interpolation model', other: 'Other model file' };
  var CAT_ORDER = ['checkpoints', 'diffusion_models', 'text_encoders', 'vae', 'loras', 'controlnet', 'model_patches', 'clip_vision',
    'style_models', 'ipadapter', 'upscale_models', 'latent_upscale_models', 'audio_encoders', 'embeddings', 'vae_approx'];

  function K(id) { return String(id); }
  function arr2(v, a, b) {
    if (Array.isArray(v)) return [Number(v[0]) || 0, Number(v[1]) || 0];
    if (v && typeof v === 'object') return [Number(v[0] != null ? v[0] : v.x) || 0, Number(v[1] != null ? v[1] : v.y) || 0];
    return [a, b];
  }

  // ---------- reading files ----------
  function pngWorkflow(buf) {
    var u = new Uint8Array(buf), dv = new DataView(buf), p = 8, out = {};
    var dec = new TextDecoder('latin1'), dec8 = new TextDecoder('utf-8');
    while (p + 8 <= u.length) {
      var len = dv.getUint32(p), type = dec.decode(u.subarray(p + 4, p + 8)), body = u.subarray(p + 8, p + 8 + len);
      if (type === 'tEXt' || type === 'iTXt') {
        var z = body.indexOf(0), key = dec.decode(body.subarray(0, z)), val;
        if (type === 'tEXt') val = dec8.decode(body.subarray(z + 1));
        else { var q = z + 3; q = body.indexOf(0, q) + 1; q = body.indexOf(0, q) + 1; val = body[z + 1] ? null : dec8.decode(body.subarray(q)); }
        if (val != null) out[key] = val;
      }
      if (type === 'IEND') break;
      p += 12 + len;
    }
    return out.workflow || out.prompt || null;
  }
  function isPng(buf) { var u = new Uint8Array(buf, 0, Math.min(8, buf.byteLength)); return u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47; }

  // ---------- normalisation ----------
  function normNode(n) {
    var size = arr2(n.size, 0, 0), wv = n.widgets_values, dict = null;
    if (wv && !Array.isArray(wv) && typeof wv === 'object') { dict = wv; wv = Object.keys(wv).map(function (k) { return wv[k]; }); }
    return {
      id: n.id, key: K(n.id), type: n.type, title: n.title || null, pos: arr2(n.pos, 0, 0), size: size, hasSize: size[0] > 0 && size[1] > 0,
      mode: n.mode || 0, collapsed: !!(n.flags && n.flags.collapsed),
      inputs: (Array.isArray(n.inputs) ? n.inputs : []).map(function (i) { return { name: i.name || '', label: i.label || i.localized_name || i.name || '', type: i.type == null ? '*' : String(i.type), link: i.link == null ? null : i.link, widget: i.widget ? (i.widget.name || i.name) : null }; }),
      outputs: (Array.isArray(n.outputs) ? n.outputs : []).map(function (o) { return { name: o.label || o.name || '', type: o.type == null ? '*' : String(o.type), links: Array.isArray(o.links) ? o.links : [] }; }),
      wv: Array.isArray(wv) ? wv : [], wdict: dict, props: n.properties || {}, color: n.color || null, bgcolor: n.bgcolor || null
    };
  }
  function normLinks(links) {
    var m = new Map();
    (Array.isArray(links) ? links : []).forEach(function (l) {
      var o;
      if (Array.isArray(l)) o = { id: l[0], o: l[1], os: l[2], t: l[3], ts: l[4], type: l[5] == null ? '*' : String(l[5]) };
      else if (l && typeof l === 'object') o = { id: l.id, o: l.origin_id, os: l.origin_slot, t: l.target_id, ts: l.target_slot, type: l.type == null ? '*' : String(l.type) };
      if (o && o.id != null) m.set(K(o.id), o);
    });
    return m;
  }
  function normGraph(g, name, id, isSub) {
    var G = { id: id, name: name, isSub: !!isSub, nodes: [], byId: new Map(), links: normLinks(g.links), dupIds: [], badNodes: 0,
      groups: (Array.isArray(g.groups) ? g.groups : []).map(function (x) { var b = x.bounding || [0, 0, 0, 0]; return { title: x.title || '', x: +b[0] || 0, y: +b[1] || 0, w: +b[2] || 0, h: +b[3] || 0, color: x.color || '#3f789e', fontSize: x.font_size || 24 }; }) };
    (Array.isArray(g.nodes) ? g.nodes : []).forEach(function (n) {
      if (!n || typeof n !== 'object' || n.id == null) { G.badNodes++; return; }
      var nn = normNode(n);
      if (G.byId.has(nn.key)) G.dupIds.push(nn.key);
      G.byId.set(nn.key, nn); G.nodes.push(nn);
    });
    if (isSub) {
      G.io = { inp: g.inputNode || null, out: g.outputNode || null, inputs: Array.isArray(g.inputs) ? g.inputs : [], outputs: Array.isArray(g.outputs) ? g.outputs : [] };
    }
    return G;
  }
  function apiToGraph(obj) {
    var ids = Object.keys(obj), nodes = [], links = [], lid = 1, outs = {};
    ids.forEach(function (id) { outs[id] = 0; });
    var tmp = ids.map(function (id) {
      var e = obj[id], ins = [], wd = {};
      Object.keys(e.inputs || {}).forEach(function (k) {
        var v = e.inputs[k];
        if (Array.isArray(v) && v.length === 2 && obj[K(v[0])] !== undefined && typeof v[1] === 'number') {
          ins.push({ name: k, type: '*', link: lid, _o: K(v[0]), _os: v[1] });
          outs[K(v[0])] = Math.max(outs[K(v[0])], v[1] + 1);
          lid++;
        } else wd[k] = v;
      });
      return { id: id, type: e.class_type, title: e._meta && e._meta.title, inputs: ins, wd: wd };
    });
    var depth = {}, byId = {};
    tmp.forEach(function (n) { byId[n.id] = n; });
    function dep(id, seen) { if (depth[id] != null) return depth[id]; if (seen[id]) return 0; seen[id] = 1; var d = 0; byId[id].inputs.forEach(function (i) { d = Math.max(d, dep(i._o, seen) + 1); }); return (depth[id] = d); }
    tmp.forEach(function (n) { dep(n.id, {}); });
    var colY = {};
    tmp.forEach(function (n) {
      var def = D.core[n.type], on = [];
      for (var i = 0; i < outs[n.id]; i++) on.push({ name: (def && def.o && def.o[i]) || 'out ' + i, type: (def && def.o && def.o[i]) || '*', links: [] });
      var h = Math.max(n.inputs.length, on.length) * 20 + Object.keys(n.wd).length * 24 + 16, d = depth[n.id];
      colY[d] = colY[d] || 0;
      nodes.push({ id: n.id, type: n.type, title: n.title, pos: [d * 380, colY[d]], size: [300, Math.max(h, 40)], mode: 0, flags: {},
        inputs: n.inputs.map(function (i, idx) { links.push([i.link, i._o, i._os, n.id, idx, '*']); return { name: i.name, type: '*', link: i.link }; }),
        outputs: on, widgets_values: n.wd, properties: {} });
      colY[d] += Math.max(h, 40) + 70;
    });
    var nb = {}; nodes.forEach(function (n) { nb[K(n.id)] = n; });
    links.forEach(function (l) { var o = nb[K(l[1])], t = nb[K(l[3])]; if (o && o.outputs[l[2]]) { o.outputs[l[2]].links.push(l[0]); l[5] = o.outputs[l[2]].type; var ti = t.inputs[l[4]]; if (ti) ti.type = l[5]; } });
    return { nodes: nodes, links: links, groups: [] };
  }

  function load(text) {
    var raw, res = { ok: false, fatal: null, format: 'graph', root: null, subs: new Map(), raw: null };
    if (typeof text !== 'string' || !text.trim()) { res.fatal = { title: 'The file is empty', detail: 'There is nothing to read. Export the workflow again from ComfyUI (Workflow > Export).' }; return res; }
    try { raw = JSON.parse(text); } catch (e) {
      var m = /position (\d+)/.exec(e.message), where = '';
      if (m) { var p = +m[1], line = text.slice(0, p).split('\n').length; where = ' The parser stopped at line ' + line + ' (character ' + p + ' of ' + text.length + ').'; }
      res.fatal = { title: 'Corrupted file: not valid JSON', detail: e.message + '.' + where + ' The file is probably cut off or was edited by hand. Export it again from ComfyUI.' };
      return res;
    }
    res.raw = raw;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { res.fatal = { title: 'Not a ComfyUI workflow', detail: 'The JSON parsed, but the top level is not a workflow object.' }; return res; }
    if (raw.workflow && raw.workflow.nodes) raw = raw.workflow;
    var g = raw;
    if (!Array.isArray(raw.nodes)) {
      var keys = Object.keys(raw), api = keys.length > 0 && keys.every(function (k) { return raw[k] && typeof raw[k] === 'object' && typeof raw[k].class_type === 'string'; });
      if (raw.prompt && typeof raw.prompt === 'object' && !api) { var pk = Object.keys(raw.prompt); if (pk.length && pk.every(function (k) { return raw.prompt[k] && raw.prompt[k].class_type; })) { raw = raw.prompt; api = true; } }
      if (!api) { res.fatal = { title: 'Not a ComfyUI workflow', detail: 'The JSON has no "nodes" list and is not in API format either. Check that you exported the workflow itself, not a settings or model file.' }; return res; }
      res.format = 'api'; g = apiToGraph(raw);
    }
    res.root = normGraph(g, 'Workflow', 'root', false);
    res.meta = { version: raw.version, frontend: raw.extra && raw.extra.frontendVersion, groupNodes: (raw.extra && raw.extra.groupNodes) || null, models: Array.isArray(raw.models) ? raw.models : [] };
    var defs = raw.definitions && Array.isArray(raw.definitions.subgraphs) ? raw.definitions.subgraphs : [];
    defs.forEach(function (sg) { if (sg && sg.id) res.subs.set(sg.id, normGraph(sg, sg.name || 'Subgraph', sg.id, true)); });
    res.ok = true;
    return res;
  }

  // ---------- widgets ----------
  function widgetRows(node) {
    var def = D.core[node.type], rows = [], i;
    if (node.wdict) { Object.keys(node.wdict).forEach(function (k) { rows.push({ name: k, value: node.wdict[k], folder: '' }); }); return rows; }
    var vals = node.wv;
    if (def && def.i && def.i.length) {
      var idx = 0, names = [];
      def.i.forEach(function (inp) { if (WTYPES[inp[1]] && !(inp[2] & 2)) { names.push({ n: inp[0], f: inp[3] }); if (inp[2] & 4) names.push({ n: 'control after generate', f: '' }); } });
      if (names.length && Math.abs(names.length - vals.length) <= 1 || (names.length && def.p !== 1 && names.length === vals.length)) {
        for (i = 0; i < vals.length; i++) rows.push({ name: names[i] ? names[i].n : '', value: vals[i], folder: names[i] ? names[i].f : '' });
        return rows;
      }
    }
    var wnames = node.inputs.filter(function (x) { return x.widget; }).map(function (x) { return x.label || x.widget; });
    var exact = wnames.length === vals.length && !def;
    for (i = 0; i < vals.length; i++) rows.push({ name: exact ? wnames[i] : '', value: vals[i], folder: '' });
    return rows;
  }
  function isSubType(t, subs) { return subs.has(t); }
  function isOutputType(node, subs, seen) {
    var def = D.core[node.type];
    if (def) return !!def.out;
    if (subs.has(node.type)) {
      seen = seen || {}; if (seen[node.type]) return false; seen[node.type] = 1;
      return subs.get(node.type).nodes.some(function (n) { return n.mode === 0 && isOutputType(n, subs, seen); });
    }
    if (FRONTEND[node.type]) return false;
    return /^(save|preview)|videocombine|saveimage|savevideo|showtext|display|image ?save|export/i.test(String(node.type));
  }

  // ---------- model helpers ----------
  function guessCategory(nodeType, name) {
    var s = (nodeType + ' ' + name).toLowerCase();
    if (/lora|lycoris|lokr/.test(s)) return 'loras';
    if (/control_?net|controllora|t2i_?adapter/.test(s)) return 'controlnet';
    if (/ip_?adapter/.test(s)) return 'ipadapter';
    if (/clip_?vision|sigclip|siglip/.test(s)) return 'clip_vision';
    if (/upscale|esrgan|swinir|4x|2x[-_]/.test(s)) return 'upscale_models';
    if (/\bvae|vae\b|_vae|vae_/.test(s)) return 'vae';
    if (/sam2?_|segment|\bsam\b|samloader/.test(s)) return 'sams';
    if (/ultralytics|yolo|bbox|segm\b|detector/.test(s)) return 'ultralytics';
    if (/text_?enc|cliploader|t5|umt5|clip_l|clip_g|qwen.*vl|llava|gemma|byt5/.test(s)) return 'text_encoders';
    if (/checkpoint|ckpt/.test(s)) return 'checkpoints';
    if (/unet|diffusion|modelloader|gguf/.test(s)) return 'diffusion_models';
    if (/animatediff|motion/.test(s)) return 'animatediff_models';
    if (/insightface|inswapper|antelope/.test(s)) return 'insightface';
    return 'other';
  }
  function base(n) { return String(n).split(/[\\/]/).pop(); }
  function hfRepo(url) { var m = /^https?:\/\/huggingface\.co\/([^/]+\/[^/]+)\/(?:resolve|blob)\//.exec(url || ''); return m ? 'https://huggingface.co/' + m[1] : null; }
  // ---------- model lookup chain: workflow -> author's notes -> catalogue -> community list -> searches ----------
  function norm(x) { return String(x).toLowerCase().replace(MODEL_EXT, '').replace(/[^a-z0-9]/g, ''); }
  function toks(x) { return String(x).toLowerCase().replace(MODEL_EXT, '').split(/[^a-z0-9]+/).filter(Boolean); }
  var URL_DIRS = { vae: 'vae', vae_approx: 'vae_approx', text_encoders: 'text_encoders', text_encoder: 'text_encoders', clip: 'text_encoders', loras: 'loras', lora: 'loras',
    diffusion_models: 'diffusion_models', unet: 'diffusion_models', checkpoints: 'checkpoints', upscale_models: 'upscale_models', latent_upscale_models: 'latent_upscale_models',
    frame_interpolation: 'frame_interpolation', clip_vision: 'clip_vision', controlnet: 'controlnet', embeddings: 'embeddings' };
  function dirFromUrl(u) { var parts = String(u).split(/[?#]/)[0].split('/'); for (var i = parts.length - 2; i > 2; i--) if (URL_DIRS[parts[i]]) return URL_DIRS[parts[i]]; return ''; }
  // every link an author wrote in a Note / MarkdownNote node
  function noteLinks(L) {
    var out = [], seen = {};
    function add(text, url) { url = String(url).replace(/[\s)>.,]+$/, ''); if (!/^https:\/\//i.test(url) || seen[url]) return; seen[url] = 1;
      var file = ''; try { file = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop()); } catch (e) {}
      out.push({ text: String(text || '').replace(/\s+/g, ' ').trim(), url: url, file: MODEL_EXT.test(file) ? file : '' }); }
    function scan(nodes) { (nodes || []).forEach(function (n) {
      if (!/note/i.test(String(n.type))) return;
      (n.wv || n.widgets_values || []).forEach(function (v) {
        if (typeof v !== 'string') return; var m, re = /\[([^\]]*)\]\(\s*(https:\/\/[^\s)]+)\s*\)/g;
        while ((m = re.exec(v))) add(m[1], m[2]);
        var re2 = /https:\/\/[^\s)\]"'<>]+/g; while ((m = re2.exec(v))) add('', m[0]);
      }); }); }
    try { scan(L.root.nodes); L.subs.forEach(function (G) { scan(G.nodes); }); } catch (e) {}
    return out;
  }
  function fromNotes(b, notes) {
    var nb = norm(b), exact = null, loose = [], tb = toks(b);
    notes.forEach(function (l) {
      var names = [l.file, base(l.text)].filter(Boolean);
      if (names.some(function (x) { return norm(x) === nb; })) { if (!exact || (l.file && !exact.file)) exact = l; return; }
      if (tb.length >= 3 && names.some(function (x) { var t = toks(x); return t.length >= tb.length && tb.every(function (w) { return t.indexOf(w) >= 0; }); })) loose.push(l);
    });
    if (exact) return { l: exact, conf: 'found' };
    if (loose.length === 1) return { l: loose[0], conf: 'likely' };
    return null;
  }
  var catIndex = null;
  function catalogue(b) {
    if (!catIndex) {
      catIndex = {};
      var put = function (k, e) { var n = norm(k); if (n && !catIndex[n]) catIndex[n] = e; };
      Object.keys(D.models).forEach(function (k) { var v = D.models[k]; put(k, { key: k, url: v[0], dir: v[1], base: v[2] || '', size: v[3] || '', page: '', src: 'catalogue' }); });
      var X = root.NOODLE_MODELS_EXTRA || {}; Object.keys(X).forEach(function (k) { var v = X[k]; if (Array.isArray(v) && v[0]) put(k, { key: k, url: v[0], dir: v[1] || '', base: v[2] || '', size: v[3] || '', page: v[4] || '', src: 'catalogue' }); });
      var C = root.NOODLE_COMMUNITY || {}; Object.keys(C).forEach(function (k) { var v = C[k] || {}; if (v.url || v.page) put(k, { key: k, url: v.url || '', dir: v.type || '', base: v.base || '', size: v.size || '', page: v.page || '', src: 'community list' }); });
    }
    var e = catIndex[norm(b)]; if (!e) return null;
    return { e: e, conf: e.key === b ? 'found' : 'likely' };
  }
  var QUANT = /(^|[^a-z0-9])(fp8|fp16|fp32|bf16|int4|int8|nf4|q[2-8](_[a-z0-9]+)*)(?![a-z0-9])/i;
  function fileFormat(b) { var ext = (MODEL_EXT.exec(b) || ['', ''])[1].toLowerCase(), q = QUANT.exec(b.replace(MODEL_EXT, '')); return ext + (q ? ' · ' + q[2].toLowerCase() : ''); }
  var NOISE = /^(v\d+[a-z0-9]*|\d+(\.\d+)?(gb|b|k)|fp(8|16|32)|bf16|int[48]|nf4|q\d.*|e4m3fn|e5m2|scaled|pruned?|prune|convrot|w\d+a\d+|g\d+|safetensors|final|ema|emaonly|half|full|merged?|fixed)$/i;
  function looseQuery(stem) {
    var words = stem.replace(/(\d)\.(\d)/g, '$1$2').replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean), out = [];
    for (var i = 0; i < words.length && out.length < 3; i++) { if (NOISE.test(words[i])) { if (out.length) break; else continue; } out.push(words[i].toLowerCase()); }
    return out.length ? out.join(' ') : stem;
  }
  function pageOf(url) { return hfRepo(url) || null; }
  function modelLinks(name, known, cat, notes) {
    var b = base(name), links = [], k = known[b] || known[name], r = { links: links, exact: false, conf: null, src: null, size: '', dir: '', base: '' };
    function direct(url, page, how) {
      page = page || pageOf(url);
      if (/^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/blob\//.test(url || '')) url = url.replace('/blob/', '/resolve/');
      if (page && page !== url) links.push({ label: 'Model page', href: page });
      if (url) links.push({ label: /\.(safetensors|sft|ckpt|pt|pth|bin|gguf|onnx)(\?|$)/i.test(url) || /\/api\/download\//.test(url) ? 'Download file' : 'Open link', href: url });
      r.exact = true; r.how = how;
    }
    // 1 saved in the workflow by ComfyUI
    if (k && k.url) { direct(k.url, null, 'Link saved in the workflow.'); r.conf = 'found'; r.src = k.src || 'workflow'; r.dir = k.dir; return r; }
    // 2 written by the author in a note
    var n = fromNotes(b, notes || []);
    if (n) { direct(n.l.url, null, n.conf === 'found' ? 'Link from the author’s note in this workflow.' : 'The author’s note links a file with a very similar name' + (n.l.file ? ' (' + n.l.file + ')' : '') + '. Check it is the one you need.');
      r.conf = n.conf; r.src = 'note'; r.dir = dirFromUrl(n.l.url); var c0 = catalogue(n.l.file || b); if (c0) r.size = c0.e.size; return r; }
    // 3 + 4 built-in catalogue, then the community list
    var c = catalogue(b);
    if (c) { direct(c.e.url, c.e.page, c.conf === 'found' ? 'Matched by file name in the ' + c.e.src + '.' : 'The ' + c.e.src + ' has a file with almost the same name (' + c.e.key + '). Check it is the one you need.');
      r.conf = c.conf; r.src = c.e.src; r.dir = c.e.dir; r.size = c.e.size; r.base = c.e.base; return r; }
    // 5 searches. Hugging Face and Civitai index model names, not file names, so use the first meaningful words
    var stem = b.replace(MODEL_EXT, ''), short = looseQuery(stem), q = encodeURIComponent(short);
    links.push({ label: 'Search Hugging Face', href: 'https://huggingface.co/models?search=' + q });
    if (cat === 'loras' || cat === 'checkpoints' || cat === 'embeddings' || cat === 'controlnet' || cat === 'upscale_models' || cat === 'other' || cat === 'diffusion_models')
      links.push({ label: 'Search Civitai', href: 'https://civitai.red/search/models?query=' + q });
    links.push({ label: 'Search the web', href: 'https://www.google.com/search?q=' + encodeURIComponent('"' + stem + '"') });
    r.query = short; return r;
  }

  // ---------- custom node detective ----------
  // some packs (rgthree, ...) register nodes the Manager cannot list; it gives a name pattern instead
  var patRe = null;
  function byPattern(t) {
    if (!patRe) patRe = (D.patterns || []).map(function (e) { try { return [new RegExp(e[0]), e[1]]; } catch (x) { return null; } }).filter(Boolean);
    var out = []; patRe.forEach(function (e) { if (e[0].test(String(t))) out.push(e[1]); });
    return out.length ? out : null;
  }
  var normIndex = null;
  function normName(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function buildIndex() { normIndex = {}; for (var k in D.nodeMap) { var n = normName(k); if (n && !normIndex[n]) normIndex[n] = k; } }
  var STOP = { image: 1, images: 1, load: 1, save: 1, mask: 1, latent: 1, text: 1, string: 1, clip: 1, model: 1, video: 1, audio: 1, conditioning: 1,
    ksampler: 1, sampler: 1, empty: 1, preview: 1, apply: 1, lora: 1, vae: 1, controlnet: 1, control: 1, float: 1, math: 1, simple: 1, batch: 1,
    crop: 1, color: 1, upscale: 1, comfy: 1, comfyui: 1, node: 1, show: 1, create: 1, convert: 1, prompt: 1, loader: 1, custom: 1, basic: 1, advanced: 1 };
  function prefixes(t) {
    var words = String(t).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean), out = [];
    for (var n = Math.min(3, words.length - 1); n >= 1; n--) { var p = words.slice(0, n).join('').toLowerCase(); if (p.length >= 3 && !(n === 1 && STOP[p])) out.push(p); }
    return out;
  }
  // exact name with different case/punctuation, else packs whose nodes share the same name prefix
  function detect(t) {
    if (!normIndex) buildIndex();
    var hit = normIndex[normName(t)];
    if (hit && D.nodeMap[hit]) return { exactish: hit, packs: D.nodeMap[hit] };
    var ps = prefixes(t), keys = Object.keys(D.nodeMap);
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i], count = {}, total = 0;
      keys.forEach(function (k) { if (normName(k).indexOf(p) === 0) { total++; D.nodeMap[k].forEach(function (ix) { count[ix] = (count[ix] || 0) + 1; }); } });
      var top = Math.max.apply(null, Object.keys(count).map(function (k) { return count[k]; }));
      var ranked = Object.keys(count).map(Number).sort(function (a, b) { return Math.abs(count[b] - count[a]) > top * 0.1 ? count[b] - count[a] : a - b; });
      if (ranked.length && count[ranked[0]] >= 3 && count[ranked[0]] / total >= 0.4)
        return { prefix: p, cands: ranked.slice(0, 3).filter(function (ix) { return count[ix] >= 3; }).map(function (ix) { return { title: D.packs[ix][1] || D.packs[ix][0].split('/').pop(), url: D.packs[ix][0], n: count[ix] }; }) };
    }
    return null;
  }
  // rebuild the pack catalogue from freshly downloaded ComfyUI-Manager files
  function setCatalogue(extMap, nodeList, stamp) {
    var meta = {}, packs = [], nm = {}, pats = [];
    (nodeList.custom_nodes || []).forEach(function (c, i) { (c.files || []).concat([c.reference || '']).forEach(function (f) { f = String(f).replace(/\/$/, ''); if (!(f in meta)) meta[f] = [i, c]; }); });
    Object.keys(extMap).forEach(function (url) {
      var m = meta[url.replace(/\/$/, '')]; if (!m) return;
      var idx = packs.length; packs.push([m[1].reference || url, m[1].title || '', m[1].id || '', m[0]]);
      if (m[1].nodename_pattern) pats.push([m[1].nodename_pattern, idx]);
      (extMap[url][0] || []).forEach(function (n) { if (!D.core[n]) (nm[n] = nm[n] || []).push(idx); });
    });
    Object.keys(nm).forEach(function (n) { nm[n] = nm[n].filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return packs[a][3] - packs[b][3]; }).slice(0, 6); });
    if (packs.length < 1000) throw new Error('catalogue looks incomplete');
    D.packs = packs.map(function (p) { return p.slice(0, 3); }); D.nodeMap = nm; D.patterns = pats; patRe = null; D.built = stamp; D.live = true; normIndex = null;
    return { packs: packs.length, names: Object.keys(nm).length };
  }

  // ---------- analysis ----------
  var RANK = { req: 3, cond: 2, unused: 1, off: 0 };
  function analyze(L) {
    var issues = [], subs = L.subs;
    function issue(level, title, detail, node, graph) { issues.push({ level: level, title: title, detail: detail || '', nodeKey: node ? node.key : null, graphId: graph ? graph.id : null }); }
    if (!L.ok) {
      issues.push({ level: 'error', title: L.fatal.title, detail: L.fatal.detail });
      return { status: 'error', issues: issues, models: [], packs: [], kind: null, stats: null, inst: [] };
    }
    var inst = []; // every node instance with need
    var needMaps = new Map();

    function validLink(G, inp) {
      if (inp.link == null) return null;
      var l = G.links.get(K(inp.link));
      if (!l) return null;
      if (G.isSub && Number(l.o) === -10) return l;
      return G.byId.has(K(l.o)) ? l : null;
    }
    // which inputs each output of a subgraph really depends on, so a cable that leaves a subgraph and
    // comes back into a different, unrelated input is not mistaken for a loop
    var subDeps = new Map();
    function depsOf(G, seen) {
      if (subDeps.has(G.id)) return subDeps.get(G.id);
      seen = seen || {}; if (seen[G.id] || !G.io) return []; seen[G.id] = 1;
      var res = [];
      G.io.outputs.forEach(function (_, j) {
        var names = new Set(), visited = new Set(), st = [];
        G.links.forEach(function (l) { if (Number(l.t) === -20 && Number(l.ts) === j) st.push([K(l.o), Number(l.os)]); });
        while (st.length) {
          var cur = st.pop();
          if (cur[0] === '-10') { var io = G.io.inputs[cur[1]]; if (io) names.add(io.name); continue; }
          var n = G.byId.get(cur[0]); if (!n) continue;
          var vk = subs.has(n.type) ? cur[0] + '|' + cur[1] : cur[0]; if (visited.has(vk)) continue; visited.add(vk);
          relevantInputs(n, cur[1], seen).forEach(function (inp) { var l = validLink(G, inp); if (l) st.push([K(l.o), Number(l.os)]); });
        }
        res[j] = names;
      });
      delete seen[G.id]; subDeps.set(G.id, res); return res;
    }
    function relevantInputs(n, outSlot, seen) {
      if (!subs.has(n.type)) return n.inputs;
      var d = depsOf(subs.get(n.type), seen)[outSlot];
      return d ? n.inputs.filter(function (i) { return d.has(i.name); }) : n.inputs;
    }
    function computeNeed(G, seed, depth) {
      // seed: null for root; otherwise 'req' | 'cond' | 'off' inherited from the parent subgraph node
      var need = new Map(), queue = [];
      function push(key, s) { var cur = need.get(key); if (!cur || RANK[s] > RANK[cur]) { need.set(key, s); queue.push(key); } }
      var start = seed == null ? 'req' : seed;
      if (start !== 'off') {
        G.nodes.forEach(function (n) { if (n.mode === 0 && isOutputType(n, subs)) push(n.key, start); });
        if (G.isSub) G.links.forEach(function (l) { if (Number(l.t) === -20 && G.byId.has(K(l.o))) push(K(l.o), start); });
      }
      while (queue.length) {
        var key = queue.shift(), n = G.byId.get(key), s = need.get(key);
        if (!n) continue;
        var isSwitch = n.type === 'ComfySwitchNode' || /switch/i.test(String(n.type)) && n.inputs.filter(function (i) { return !i.widget; }).length >= 2;
        var common = null;
        if (isSwitch) { // nodes that feed every branch of a switch are needed whichever way it is set
          n.inputs.forEach(function (inp) {
            if (inp.widget || /^(switch|select|boolean|index|condition)$/i.test(inp.name)) return;
            var l = validLink(G, inp); if (!l || Number(l.o) === -10) return;
            var set = new Set(), st = [K(l.o)];
            while (st.length) { var k2 = st.pop(); if (set.has(k2)) continue; set.add(k2); var m2 = G.byId.get(k2); if (m2) m2.inputs.forEach(function (i2) { var l2 = validLink(G, i2); if (l2 && Number(l2.o) !== -10) st.push(K(l2.o)); }); }
            if (common === null) common = set; else { var keep = new Set(); common.forEach(function (v) { if (set.has(v)) keep.add(v); }); common = keep; }
          });
          if (common) common.forEach(function (k3) { push(k3, s); });
        }
        n.inputs.forEach(function (inp) {
          var l = validLink(G, inp); if (!l || Number(l.o) === -10) return;
          var s2 = s;
          if (isSwitch && !inp.widget && !/^(switch|select|boolean|index|condition)$/i.test(inp.name)) s2 = 'cond';
          push(K(l.o), s2);
        });
      }
      needMaps.set(G.id + '|' + (seed || 'root'), need);
      G.nodes.forEach(function (n) {
        var s = need.get(n.key) || 'unused';
        if (start === 'off' || n.mode === 2 || n.mode === 4) s = 'off';
        inst.push({ node: n, graph: G, need: s, depth: depth });
        if (subs.has(n.type) && depth < 6) computeNeed(subs.get(n.type), s === 'unused' ? 'off' : s, depth + 1);
      });
    }
    computeNeed(L.root, null, 0);
    // a graph can be instanced several times: keep the strongest need per (graph,node)
    var best = new Map();
    inst.forEach(function (x) { var k = x.graph.id + '|' + x.node.key, c = best.get(k); if (!c || RANK[x.need] > RANK[c.need]) best.set(k, x); });
    inst = Array.from(best.values());
    var needOf = function (G, n) { var b = best.get(G.id + '|' + n.key); return b ? b.need : 'unused'; };

    // --- structure checks per graph ---
    var graphs = [L.root]; subs.forEach(function (g) { graphs.push(g); });
    var usedSubs = {}; inst.forEach(function (x) { if (subs.has(x.node.type)) usedSubs[x.node.type] = 1; });
    if (!L.root.nodes.length) issue('error', 'The workflow has no nodes', 'The file is a valid workflow container but there is nothing in it to run.');
    graphs.forEach(function (G) {
      if (G.isSub && !usedSubs[G.id]) return;
      var where = G.isSub ? ' (inside subgraph "' + G.name + '")' : '';
      if (G.badNodes) issue('error', G.badNodes + ' node entr' + (G.badNodes > 1 ? 'ies are' : 'y is') + ' unreadable' + where, 'These entries have no id, so ComfyUI cannot place or connect them. The file is damaged.', null, G);
      if (G.dupIds.length) issue('error', 'Duplicate node ids' + where, 'Ids ' + G.dupIds.slice(0, 8).join(', ') + ' appear more than once. Cables to these nodes are ambiguous, which usually means two workflows were merged by hand.', G.byId.get(G.dupIds[0]), G);
      var broken = 0, firstBroken = null, mism = 0, firstMism = null, mismTxt = '';
      G.nodes.forEach(function (n) {
        if (n.type == null || n.type === '') { issue('error', 'Node #' + n.key + ' has no type' + where, 'ComfyUI cannot tell which node this is. The entry is damaged.', n, G); return; }
        n.inputs.forEach(function (inp) {
          if (inp.link == null) return;
          var l = validLink(G, inp);
          if (!l) { broken++; firstBroken = firstBroken || n; inp.broken = true; return; }
          var ot = l.type, it = inp.type;
          if (ot && it && ot !== '*' && it !== '*' && ot !== it && !/[,*]|COMBO|ANY/i.test(ot + it) && SOCKETS[ot] && SOCKETS[it]) { mism++; if (!firstMism) { firstMism = n; mismTxt = ot + ' cable into the ' + it + ' input "' + inp.name + '"'; } }
        });
      });
      if (broken) issue('warning', broken + ' broken cable' + (broken > 1 ? 's' : '') + where, 'Some inputs point at a cable or node that is not in the file. ComfyUI drops these on load, so the inputs end up unconnected.', firstBroken, G);
      if (mism) issue('warning', mism + ' cable' + (mism > 1 ? 's connect' : ' connects') + ' mismatched types' + where, 'For example: ' + mismTxt + '. ComfyUI will refuse to run this connection.', firstMism, G);
      // cycles (port-aware through subgraph nodes)
      var state = {}, cyc = null;
      function dfs(key, slot) {
        var n = G.byId.get(key); if (!n || cyc) return;
        var sk = subs.has(n.type) ? key + '|' + slot : key;
        if (state[sk] === 2) return; if (state[sk] === 1) { cyc = n; return; }
        state[sk] = 1;
        relevantInputs(n, slot).forEach(function (inp) { if (cyc) return; var l = validLink(G, inp); if (!l || Number(l.o) === -10) return; dfs(K(l.o), Number(l.os)); });
        state[sk] = 2;
      }
      try { G.nodes.forEach(function (n) { if (subs.has(n.type)) n.outputs.forEach(function (_, j) { dfs(n.key, j); }); else dfs(n.key, 0); }); } catch (e) { cyc = null; }
      if (cyc) issue('error', 'Cables form a loop' + where, 'Following the cables backwards from "' + (cyc.title || (D.core[cyc.type] && D.core[cyc.type].d) || (subs.has(cyc.type) ? subs.get(cyc.type).name : cyc.type)) + '" leads back to itself, so ComfyUI cannot order the nodes for execution.', cyc, G);
    });

    // --- node sources, required inputs ---
    var packs = new Map(), unknownTypes = new Map(), apiNodes = 0, offCount = 0, unusedCount = 0, inputFiles = [];
    function packFor(key, title, url, registry) {
      if (!packs.has(key)) packs.set(key, { key: key, title: title, url: url, registry: registry || null, types: new Map(), need: 'off', ver: null, alt: 0, guessed: false });
      return packs.get(key);
    }
    var unresolved = new Map(); // type -> [inst]
    inst.forEach(function (x) {
      var n = x.node, G = x.graph, t = String(n.type);
      if (x.need === 'off') offCount++;
      if (n.type == null || n.type === '') return;
      if (FRONTEND[t]) return;
      if (subs.has(t)) return;
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(t)) { if (x.need !== 'off') issue('error', 'Subgraph definition is missing', 'Node "' + (n.title || '#' + n.key) + '" refers to a subgraph that is not stored in this file, so its contents are lost.', n, G); return; }
      var def = D.core[t], cnr = n.props.cnr_id, aux = n.props.aux_id;
      if (x.need === 'unused') unusedCount++;
      if (def || cnr === 'comfy-core') {
        if (def && def.api && x.need !== 'off') apiNodes++;
        if (def && !def.p && x.need !== 'off') {
          def.i.forEach(function (inp) {
            if (!SOCKETS[inp[1]] || (inp[2] & 1) || (inp[2] & 8)) return;
            var slot = n.inputs.filter(function (i) { return i.name === inp[0]; })[0];
            var label = (n.title || def.d || t);
            if (!slot && L.format === 'api') { issue(x.need === 'req' ? 'error' : 'warning', '"' + label + '" is missing its ' + inp[0] + ' input', 'This required ' + inp[1] + ' input has nothing connected. ComfyUI rejects the prompt with "Required input is missing".', n, G); return; }
            if (!slot) { if (x.need === 'req' && L.format === 'graph') issue('warning', '"' + label + '" has no ' + inp[0] + ' input in this file', 'ComfyUI ' + D.coreVersion + ' expects a required ' + inp[1] + ' input named "' + inp[0] + '". The workflow was probably saved with a different version; reload and reconnect it if it fails.', n, G); return; }
            if (slot.link != null && !slot.broken) return;
            if (L.format === 'api') { issue(x.need === 'req' ? 'error' : 'warning', '"' + label + '" is missing its ' + inp[0] + ' input', 'This required ' + inp[1] + ' input has nothing connected.', n, G); return; }
            var lvl = x.need === 'req' ? 'error' : x.need === 'cond' ? 'warning' : 'note';
            issue(lvl, '"' + label + '" is missing its ' + inp[0] + ' input', 'This required ' + inp[1] + ' input has no cable' + (slot.broken ? ' (the cable in the file is broken)' : '') + '. ' + (lvl === 'error' ? 'ComfyUI will stop with "Required input is missing".' : lvl === 'warning' ? 'It sits behind a switch, so it only fails when that branch is used.' : 'The node is not connected to any output, so it will not run.'), n, G);
          });
        }
        if (/^Load(Image|Video|Audio|3D)/.test(t) && x.need !== 'off') { var f = n.wv.filter(function (v) { return typeof v === 'string' && /\.\w{2,5}$/.test(v); })[0]; if (f) inputFiles.push(f); }
        return;
      }
      if (/^workflow[>\/]/.test(t)) { if (x.need !== 'off') issue('warning', 'Legacy group node "' + t.replace(/^workflow[>\/]/, '') + '"', 'Group nodes were replaced by subgraphs. Recent ComfyUI versions convert them on load, but check the result.', n, G); return; }
      if (cnr || aux) {
        var key = (cnr || aux).toLowerCase(), idx = -1;
        for (var i = 0; i < D.packs.length; i++) { var p = D.packs[i]; if ((cnr && p[2] && p[2].toLowerCase() === key) || (aux && p[0].toLowerCase().indexOf('github.com/' + aux.toLowerCase()) >= 0)) { idx = i; break; } }
        var url = aux ? 'https://github.com/' + aux : idx >= 0 ? D.packs[idx][0] : null;
        if (!url && D.nodeMap[t]) url = D.packs[D.nodeMap[t][0]][0];
        var pk = packFor(key, idx >= 0 ? D.packs[idx][1] : (cnr || aux), url, cnr ? 'https://registry.comfy.org/nodes/' + encodeURIComponent(cnr) : null);
        pk.types.set(t, (pk.types.get(t) || 0) + 1); if (RANK[x.need] > RANK[pk.need]) pk.need = x.need; if (n.props.ver) pk.ver = String(n.props.ver);
        x.pack = pk; return;
      }
      if (!unresolved.has(t)) unresolved.set(t, []);
      unresolved.get(t).push(x);
    });
    // resolve remaining types through the ComfyUI-Manager node map (pick the pack that explains most of them)
    var votes = {}, possible = {};
    unresolved.forEach(function (list, t) { (D.nodeMap[t] || D.nodeMap[t.trim()] || byPattern(t) || []).forEach(function (i) { votes[i] = (votes[i] || 0) + 1; }); });
    packs.forEach(function (p) { for (var i = 0; i < D.packs.length; i++) if (D.packs[i][0] === p.url) votes[i] = (votes[i] || 0) + 100; });
    unresolved.forEach(function (list, t) {
      var c = D.nodeMap[t] || D.nodeMap[t.trim()] || byPattern(t), fuzzy = null;
      if (!c || !c.length) {
        var det = detect(t);
        if (det && det.exactish) { c = det.packs; fuzzy = det.exactish; }
        else {
          unknownTypes.set(t, list);
          if (det) possible[t] = det;
          list.forEach(function (x) { x.unknown = true; });
          return;
        }
      }
      var bestI = c[0]; c.forEach(function (i) { if ((votes[i] || 0) > (votes[bestI] || 0)) bestI = i; });
      var p = D.packs[bestI], pk = packFor(p[0].toLowerCase(), p[1] || p[0].split('/').pop(), p[0], null);
      pk.guessed = true; pk.alt = Math.max(pk.alt, c.length - 1); if (fuzzy) pk.fuzzy = (pk.fuzzy || []).concat([t + ' \u2248 ' + fuzzy]);
      list.forEach(function (x) { pk.types.set(t, (pk.types.get(t) || 0) + 1); if (RANK[x.need] > RANK[pk.need]) pk.need = x.need; x.pack = pk; });
    });
    // the author's own repo links (from notes) fill in packs the catalogue cannot place, or offer a second opinion
    var notes = noteLinks(L);
    var repoLinks = notes.filter(function (l) { return /^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/i.test(l.url); });
    function tset(x) { return toks(String(x).split('/').pop()).sort().join(' '); }
    packs.forEach(function (pk) {
      var want = [tset(pk.key), tset(pk.title)];
      var hit = repoLinks.filter(function (l) { return want.indexOf(tset(l.url.replace(/\/$/, ''))) >= 0; })[0];
      if (!hit) return; var u = hit.url.replace(/\/$/, '');
      if (!pk.url) { pk.url = u; pk.fromNote = true; } else if (pk.url.toLowerCase() !== u.toLowerCase()) pk.noteUrl = u;
    });
    var packList = Array.from(packs.values()).sort(function (a, b) { return RANK[b.need] - RANK[a.need] || a.title.localeCompare(b.title); });
    var reqPacks = packList.filter(function (p) { return p.need === 'req' || p.need === 'cond'; });
    if (reqPacks.length) issue('warning', 'Needs ' + reqPacks.length + ' custom node pack' + (reqPacks.length > 1 ? 's' : ''), reqPacks.map(function (p) { return p.title; }).join(', ') + '. Install ' + (reqPacks.length > 1 ? 'them' : 'it') + ' with ComfyUI-Manager before running; without ' + (reqPacks.length > 1 ? 'them' : 'it') + ' the nodes show up red as missing.');
    unknownTypes.forEach(function (list, t) {
      var act = list.filter(function (x) { return x.need === 'req' || x.need === 'cond'; });
      var x = act[0] || list[0];
      if (x.need === 'off') return;
      issue(act.length ? 'warning' : 'note', 'Unknown node type "' + t + '"', 'Not in ComfyUI core ' + D.coreVersion + ' or the ComfyUI-Manager catalogue (snapshot ' + D.built + '). ' + (act.length ? (possible[t] ? 'Likely from ' + possible[t].cands.map(function (c) { return c.title; }).join(' or ') + ' (their nodes share the "' + possible[t].prefix + '" name prefix). ' : '') + 'The workflow cannot run until you find and install the pack that provides it.' : 'It is not connected to an output, so it does not block the run.'), x.node, x.graph);
    });

    // --- models ---
    var known = {};
    function addKnown(m, src) { if (m && m.name && m.url) known[base(m.name)] = { url: m.url, dir: m.directory || '', src: src }; }
    (L.meta.models || []).forEach(function (m) { addKnown(m, 'workflow'); });
    inst.forEach(function (x) { (Array.isArray(x.node.props.models) ? x.node.props.models : []).forEach(function (m) { addKnown(m, 'workflow'); }); });
    var models = new Map();
    inst.forEach(function (x) {
      var n = x.node, t = String(n.type), isSub = subs.has(t);
      if (FRONTEND[t] && t !== 'PrimitiveNode') return;
      var rows = widgetRows(n), def = D.core[t];
      var folders = def ? def.i.filter(function (i) { return i[3]; }).map(function (i) { return i[3]; }) : [];
      rows.forEach(function (r) {
        var v = r.value;
        if (r.folder && def && !def.p && x.need !== 'off' && !isSub) {
          var linked = n.inputs.some(function (i) { return i.name === r.name && i.link != null; });
          if (!linked && (v == null || v === '' || /^(none|null|undefined)$/i.test(String(v))) && r.folder !== 'loras' && r.folder !== 'configs')
            issue(x.need === 'req' ? 'warning' : 'note', '"' + (n.title || def.d || t) + '" has no model selected', 'The ' + r.name + ' field is empty. Pick a file from models/' + r.folder + ' before running.', n, x.graph);
        }
        if (typeof v !== 'string' || !MODEL_EXT.test(v.trim()) || v.length > 260) return;
        v = v.trim();
        var b = base(v), cat = r.folder || '', sure = !!r.folder;
        if (!cat && known[b] && known[b].dir) { cat = known[b].dir.split('/')[0]; sure = true; }
        if (!cat && folders.length === 1) { cat = folders[0]; sure = true; }
        if (!cat && D.models[b] && D.models[b][1]) { cat = D.models[b][1].split('/')[0]; sure = true; }
        if (!cat && !isSub && t !== 'PrimitiveNode') cat = guessCategory(t, b);
        if (cat === 'unet') cat = 'diffusion_models'; if (cat === 'clip') cat = 'text_encoders';
        var m = models.get(b);
        var outer = isSub || t === 'PrimitiveNode';
        if (!m) { m = { name: v, base: b, cat: cat || '', sure: sure, need: null, outerNeed: 'off', users: [], modifier: false }; models.set(b, m); }
        if ((!m.cat || !m.sure) && cat && (sure || !m.cat)) { m.cat = cat; m.sure = sure; }
        if (outer) { if (RANK[x.need] > RANK[m.outerNeed]) m.outerNeed = x.need; }
        else if (m.need == null || RANK[x.need] > RANK[m.need]) m.need = x.need;
        if (!outer) m.users.push({ label: n.title || (def && def.d) || t, nodeKey: n.key, graphId: x.graph.id, need: x.need });
      });
    });
    var modelList = Array.from(models.values()).map(function (m) {
      if (m.need == null) m.need = m.outerNeed;
      if (!m.cat) m.cat = guessCategory('', m.base);
      var lk = modelLinks(m.name, known, m.cat, notes);
      if (!m.sure && lk.dir) { var d0 = lk.dir.split('/')[0]; m.cat = d0 === 'unet' ? 'diffusion_models' : d0 === 'clip' ? 'text_encoders' : d0; }
      m.links = lk.links; m.exact = lk.exact; m.query = lk.query; m.linkSrc = lk.src || null; m.conf = lk.conf; m.how = lk.how || ''; m.size = lk.size || ''; if (!m.size) { var sz = /(^|[^a-z0-9.])(\d+(?:\.\d+)?)\s?gb(?![a-z])/i.exec(m.base); if (sz) { m.size = sz[2] + ' GB'; m.sizeFrom = 'file name'; } } m.baseModel = lk.base || ''; m.format = fileFormat(m.base);
      m.catLabel = CAT_LABEL[m.cat] || m.cat.replace(/_/g, ' ');
      m.folder = 'models/' + (lk.dir || m.cat);
      m.modifier = m.cat === 'loras';
      if (!m.users.length) m.users = [];
      return m;
    }).sort(function (a, b) {
      var ia = CAT_ORDER.indexOf(a.cat), ib = CAT_ORDER.indexOf(b.cat); ia = ia < 0 ? 99 : ia; ib = ib < 0 ? 99 : ib;
      return RANK[b.need] - RANK[a.need] || ia - ib || a.base.localeCompare(b.base);
    });

    // --- outputs ---
    var activeOut = inst.filter(function (x) { return x.need !== 'off' && !subs.has(x.node.type) && isOutputType(x.node, subs); });
    if (L.root.nodes.length && !activeOut.length) {
      var hasUnknown = unknownTypes.size > 0 || packList.length > 0;
      issue(hasUnknown ? 'warning' : 'error', 'No output node', hasUnknown ? 'No known save or preview node was found. One of the custom nodes may act as the output; if not, nothing will be produced.' : 'Nothing saves or previews a result, so ComfyUI answers "Prompt has no outputs" and does not run. Add a Save Image or Preview node.');
    }

    // --- notes ---
    if (L.format === 'api') issue('note', 'API-format file', 'This is the "Export (API)" format. It has no layout, colours or groups, so the canvas was arranged automatically. It runs through the API but is awkward to edit.');
    if (apiNodes) issue('note', apiNodes + ' partner API node' + (apiNodes > 1 ? 's' : ''), 'These call paid cloud services through your Comfy account. They need a login and credits, and no local model file.');
    if (offCount) issue('note', offCount + ' muted or bypassed node' + (offCount > 1 ? 's' : ''), 'They are skipped when the workflow runs. Models and packs used only by them are marked optional.');
    if (unusedCount) issue('note', unusedCount + ' node' + (unusedCount > 1 ? 's are' : ' is') + ' not connected to any output', 'ComfyUI only executes nodes that lead to an output, so these are ignored.');
    if (inputFiles.length) issue('note', 'Needs your own input file' + (inputFiles.length > 1 ? 's' : ''), 'The workflow loads ' + inputFiles.slice(0, 4).join(', ') + (inputFiles.length > 4 ? ' and more' : '') + ' from the ComfyUI input folder. Pick your own file in each Load node.');

    var kind = classify(L, inst, modelList, packList, subs);
    var order = { error: 0, warning: 1, note: 2 };
    issues.sort(function (a, b) { return order[a.level] - order[b.level]; });
    var nE = issues.filter(function (i) { return i.level === 'error'; }).length, nW = issues.filter(function (i) { return i.level === 'warning'; }).length;
    return { status: nE ? 'error' : nW ? 'warning' : 'ready', issues: issues, models: modelList, packs: packList, kind: kind, inst: inst,
      counts: { error: nE, warning: nW, note: issues.length - nE - nW }, needOf: needOf, unknown: Array.from(unknownTypes.keys()), possible: possible };
  }

  // ---------- what kind of workflow is it ----------
  var FAMILIES = [['Krea 2', /krea[-_ ]?2/], ['FLUX.2', /flux[-_. ]?2/], ['FLUX.1 Kontext', /kontext/], ['FLUX.1 Krea', /flux.*krea/], ['FLUX.1', /flux/],
    ['Z-Image', /z[-_ ]?image/], ['Qwen-Image Edit', /qwen[-_ ]?image[-_ ]?edit/], ['Qwen-Image', /qwen[-_ ]?image/], ['Wan 2.2', /wan[-_ ]?2[._]?2/],
    ['Wan 2.1', /wan[-_ ]?2[._]?1/], ['Wan', /(^|[^a-z])wan[^a-z]/], ['MiniMax H3', /minimax[-_ ]?h3|(^|[^a-z0-9])h3[-_ ]/], ['LTX Video', /ltx/], ['HunyuanVideo', /hunyuan[-_ ]?video|hyvid|hunyuanvideo/],
    ['Hunyuan3D', /hunyuan[-_ ]?3d/], ['HunyuanImage', /hunyuan[-_ ]?image/], ['Stable Diffusion 3.5', /sd[-_ ]?3\.?5/], ['Stable Diffusion 3', /sd[-_ ]?3|stable[-_ ]?diffusion[-_ ]?3/],
    ['Stable Cascade', /cascade/], ['Stable Video Diffusion', /svd/],
    ['Stable Audio', /stable[-_ ]?audio/], ['ACE-Step', /ace[-_ ]?step/], ['HiDream', /hidream/], ['Chroma', /chroma/], ['Cosmos', /cosmos/],
    ['Lumina', /lumina/], ['AuraFlow', /aura[-_ ]?flow/], ['Mochi', /mochi/], ['PixArt', /pixart/], ['OmniGen', /omnigen/],
    ['Kandinsky 5', /kandinsky/], ['Ideogram 4', /ideogram/], ['SDXL', /sd[-_ ]?xl|pony|illustrious|noobai|juggernautxl|[^a-z]xl[^a-z]/],
    ['Stable Diffusion 2', /v2-1|sd[-_ ]?2[._]1|768-v/], ['Stable Diffusion 1.5', /v1-5|sd[-_ ]?1[._]?5|sd15|dreamshaper|realisticvision|anything-v/]];
  function classify(L, inst, models, packs, subs) {
    var act = inst.filter(function (x) { return x.need === 'req' || x.need === 'cond'; });
    if (!act.length) act = inst.filter(function (x) { return x.need !== 'off'; });
    var types = act.map(function (x) { return String(x.node.type); }).filter(function (t) { return !subs.has(t); });
    var has = function (re) { return types.some(function (t) { return re.test(t); }); };
    var count = function (re) { return types.filter(function (t) { return re.test(t); }).length; };
    var main = models.filter(function (m) { return (m.cat === 'diffusion_models' || m.cat === 'checkpoints') && m.need !== 'off' && m.need !== 'unused'; });
    if (!main.length) main = models.filter(function (m) { return m.cat === 'diffusion_models' || m.cat === 'checkpoints'; });
    var clipTypes = [];
    act.forEach(function (x) { if (/CLIPLoader/.test(x.node.type)) widgetRows(x.node).forEach(function (r) { if (r.name === 'type' && typeof r.value === 'string') clipTypes.push(r.value); }); });
    var fams = [];
    function famOf(str) { for (var i = 0; i < FAMILIES.length; i++) if (FAMILIES[i][1].test(' ' + str + ' ')) return FAMILIES[i][0]; return null; }
    main.forEach(function (m) { var f = famOf(m.base.toLowerCase()); if (f && fams.indexOf(f) < 0) fams.push(f); });
    // the main model can sit in an unusual folder (e.g. a merged H3 checkpoint), so also look at every active model and node name
    var h3 = models.some(function (m) { return m.need !== 'off' && m.need !== 'unused' && /minimax[-_ ]?h3|(^|[^a-z0-9])h3[-_ ]/.test(m.base.toLowerCase()); }) || has(/MiniMaxH3|^H3[A-Z]|^PK_MiniMaxH3/);
    if (h3 && fams.indexOf('MiniMax H3') < 0) fams.unshift('MiniMax H3');
    if (!fams.length) { var f0 = famOf(clipTypes.join(' ').toLowerCase()) || (main.length ? null : famOf(models.map(function (m) { return m.base.toLowerCase(); }).join(' | '))); if (f0) fams.push(f0); }
    if (has(/^ADE_|AnimateDiff/)) fams = ['AnimateDiff'];
    var family = fams.length ? fams.slice(0, 2).join(' + ') : null;
    if (!family && main.length) {
      family = main[0].base.replace(MODEL_EXT, '').replace(/[-_.]?(fp8|fp16|bf16|int8|scaled|e4m3fn|convrot|pruned|ema(only)?|q\d[_a-z0-9]*)(?![a-z])/ig, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (family.length > 28) family = family.slice(0, 27) + '\u2026';
    }
    var apiOnly = !main.length && act.some(function (x) { var d = D.core[x.node.type]; return d && d.api; });
    if (!family && apiOnly) family = 'Partner API';
    var variant = [];
    var mh = main.map(function (m) { return m.base.toLowerCase(); }).join(' ');
    [['Turbo', /turbo/], ['Lightning', /lightning/], ['Schnell', /schnell/], ['Distilled', /distill/], ['LCM', /lcm/], ['Hyper', /hyper/], ['GGUF', /\.gguf/], ['FP8', /fp8/], ['Inpaint model', /inpaint/]].forEach(function (v) { if (v[1].test(mh)) variant.push(v[0]); });

    var vidOut = has(/SaveVideo|CreateVideo|VideoCombine|SaveAnimatedWEBP|SaveWEBM|SaveAnimatedPNG/i);
    var audOut = has(/SaveAudio|PreviewAudio/i), d3Out = has(/Save3D|SaveGLB|Preview3D/i), imgOut = has(/SaveImage|PreviewImage|Image ?Save/i);
    var imgIn = has(/^LoadImage|LoadImageOutput|Load ?Image/i), vidIn = has(/LoadVideo/i);
    var sampler = count(/KSampler|SamplerCustom|^Sampler|UltimateSDUpscale|FaceDetailer|WanVideoSampler/);
    var inpaint = has(/Inpaint|SetLatentNoiseMask|LanPaint/), outpaint = has(/Outpaint/);
    var edit = has(/Kontext|ImageEdit|ReferenceLatent|InstructPix|Flux2.*Reference|EditModel/);
    var i2v = has(/ImageToVideo|ImgToVideo|I2V|FirstLastFrame|StartEnd|InpaintToVideo|FunControl|Vace/i);
    var task;
    if (vidOut) task = vidIn ? 'Video-to-video' : (i2v || imgIn) ? 'Image-to-video' : 'Text-to-video';
    else if (d3Out) task = imgIn ? 'Image-to-3D' : '3D generation';
    else if (audOut && !imgOut) task = 'Audio generation';
    else if (imgOut) task = outpaint ? 'Outpainting' : inpaint && imgIn ? 'Inpainting' : edit && imgIn ? 'Image editing' : imgIn && sampler && has(/VAEEncode/) ? 'Image-to-image' : imgIn && !sampler && has(/Upscale/) ? 'Upscaling' : sampler || apiOnly ? (imgIn ? 'Image-guided generation' : 'Text-to-image') : 'Image processing';
    else if (has(/Train/)) task = 'Model training';
    else task = act.length ? 'Utility workflow' : 'No runnable output';
    var chips = variant.slice();
    var lo = models.filter(function (m) { return m.cat === 'loras' && (m.need === 'req' || m.need === 'cond'); }).length;
    if (lo) chips.push('LoRA ×' + lo);
    if (has(/ControlNet|ControlLora|T2IAdapter/i)) chips.push('ControlNet');
    if (has(/IPAdapter|InstantID|PuLID/i)) chips.push('IP-Adapter / face ID');
    if (sampler >= 2) chips.push(sampler + ' sampling passes');
    if (has(/UpscaleWithModel|UpscaleModelLoader|UltimateSDUpscale|SeedVR|SUPIR/i)) chips.push('Model upscale');
    if (has(/FaceDetailer|ReActor|FaceRestore/i)) chips.push('Face fix');
    if (has(/TextGenerate|LLM|QwenVL|Ollama|Florence|Gemini|OpenAIChat/i)) chips.push('Prompt assistant');
    if (inpaint && task !== 'Inpainting') chips.push('Masking');
    var nSub = inst.filter(function (x) { return subs.has(x.node.type); }).length;
    if (nSub) chips.push(nSub + ' subgraph' + (nSub > 1 ? 's' : ''));
    if (apiOnly || act.some(function (x) { var d = D.core[x.node.type]; return d && d.api; })) chips.push('Partner API');

    // sampler settings
    var settings = null;
    var ks = act.filter(function (x) { return /^KSampler/.test(x.node.type) && x.need === 'req'; })[0] || act.filter(function (x) { return /^KSampler/.test(x.node.type); })[0];
    if (ks) {
      var r = {}; widgetRows(ks.node).forEach(function (w) { r[w.name] = w.value; });
      var parts = [];
      if (typeof r.steps === 'number') parts.push(r.steps + ' steps');
      if (typeof r.cfg === 'number') parts.push('CFG ' + r.cfg);
      if (typeof r.sampler_name === 'string') parts.push(r.sampler_name + (typeof r.scheduler === 'string' ? ' / ' + r.scheduler : ''));
      if (typeof r.denoise === 'number' && r.denoise !== 1) parts.push('denoise ' + r.denoise);
      if (parts.length) settings = parts.join(' · ');
    }
    // pipeline breakdown
    var cats = [['Loaders', /Loader|^Load|CheckpointLoader/], ['Prompt and conditioning', /TextEncode|Conditioning|Guidance|ControlNetApply|ReferenceLatent|Prompt/],
      ['Sampling', /Sampler|Scheduler|Sigmas|Guider|Noise|ModelSampling/], ['Latent', /Latent|VAEEncode|VAEDecode/], ['Image and mask', /Image|Mask|Crop|Resize|Scale|Upscale/],
      ['Video and audio', /Video|Audio|Frame/], ['Output', /^Save|^Preview|Combine/]];
    var bucket = {}, total = 0;
    inst.forEach(function (x) {
      var t = String(x.node.type); if (FRONTEND[t] || subs.has(t) || x.need === 'off') return;
      total++;
      var c = 'Logic and utilities';
      for (var j = cats.length - 1; j >= 0; j--) if (cats[j][1].test(t)) { c = cats[j][0]; if (j === 6 || j === 0) break; }
      if (/^Save|^Preview/.test(t)) c = 'Output'; else if (/Loader|^Load/.test(t)) c = 'Loaders'; else if (/Sampler/.test(t)) c = 'Sampling';
      bucket[c] = (bucket[c] || 0) + 1;
    });
    var pipeline = cats.map(function (c) { return c[0]; }).concat(['Logic and utilities']).filter(function (c) { return bucket[c]; }).map(function (c) { return { name: c, n: bucket[c] }; });
    var reqModels = models.filter(function (m) { return m.need === 'req'; }).length, reqPacks = packs.filter(function (p) { return p.need === 'req' || p.need === 'cond'; }).length;
    var sentences = [];
    sentences.push((family ? family + ' ' : '') + task.toLowerCase() + ' workflow with ' + total + ' working node' + (total === 1 ? '' : 's') + (nSub ? ', packed into ' + nSub + ' subgraph' + (nSub > 1 ? 's' : '') : '') + '.');
    if (main.length) sentences.push('It generates with ' + main.slice(0, 2).map(function (m) { return m.base; }).join(' and ') + (main[0].cat === 'checkpoints' ? ' (an all-in-one checkpoint)' : ' loaded as a separate diffusion model, with its own text encoder and VAE') + '.');
    sentences.push(reqPacks ? 'It depends on ' + reqPacks + ' custom node pack' + (reqPacks > 1 ? 's' : '') + '.' : packs.length ? 'It runs on core ComfyUI; the custom nodes present are optional.' : 'It runs on core ComfyUI with no custom nodes.');
    return { family: family, task: task, headline: (family ? family + ' · ' : '') + task, chips: chips, settings: settings, pipeline: pipeline, total: total,
      description: sentences.join(' '), reqModels: reqModels, modelCount: models.length, reqPacks: reqPacks, packCount: packs.length };
  }

  function report(L, A, fileName) {
    var out = ['NoodleCheck report', 'File: ' + (fileName || 'workflow'), 'Status: ' + A.status.toUpperCase() + (A.counts ? ' (' + A.counts.error + ' errors, ' + A.counts.warning + ' warnings, ' + A.counts.note + ' notes)' : '')];
    if (A.kind) { out.push('Type: ' + A.kind.headline + (A.kind.chips.length ? ' [' + A.kind.chips.join(', ') + ']' : '')); if (A.kind.settings) out.push('Sampler: ' + A.kind.settings); out.push(A.kind.description); }
    out.push('', 'Issues:'); if (!A.issues.length) out.push('  none');
    A.issues.forEach(function (i) { out.push('  [' + i.level.toUpperCase() + '] ' + i.title + (i.detail ? ' - ' + i.detail : '')); });
    out.push('', 'Models:'); if (!A.models.length) out.push('  none');
    A.models.forEach(function (m) { out.push('  [' + needLabel(m.need) + '] ' + m.catLabel + ': ' + m.name + ' -> ' + m.folder + ' | ' + m.links.map(function (l) { return l.href; }).join(' | ')); });
    out.push('', 'Custom nodes:'); if (!A.packs.length) out.push('  none');
    A.packs.forEach(function (p) { out.push('  [' + needLabel(p.need) + '] ' + p.title + ' (' + Array.from(p.types.keys()).join(', ') + ')' + (p.url ? ' | ' + p.url : '')); });
    return out.join('\n');
  }
  function needLabel(n) { return n === 'req' ? 'Required' : 'Optional'; }
  function needWhy(n, modifier) {
    return n === 'req' ? (modifier ? 'On the path to an output. Bypass its loader to run without it.' : 'On the path to an output.')
      : n === 'cond' ? 'Behind a switch, so only used when that branch is on.'
      : n === 'off' ? 'Only used by muted or bypassed nodes.' : 'Its node is not connected to any output.';
  }

  root.ComfyCheck = { load: load, analyze: analyze, widgetRows: widgetRows, pngWorkflow: pngWorkflow, isPng: isPng, report: report, needLabel: needLabel,
    needWhy: needWhy, isOutputType: isOutputType, setCatalogue: setCatalogue, detect: detect, FRONTEND: FRONTEND, data: D };
})(typeof window !== 'undefined' ? window : globalThis);
