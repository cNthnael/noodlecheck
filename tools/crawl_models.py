# crawl_models.py v1.0 - 2026-11-12 09:00 WIB
# Builds models-extra.js for NoodleCheck: file name -> [download url, models folder, base model, size, model page].
# Runs in the weekly GitHub Action (.github/workflows/update-models.yml). Visitors' browsers never call these sites.
# Standard library only. Public endpoints, no key, no login. Usage: python tools/crawl_models.py [output path]
import json, re, sys, time, datetime, urllib.request, urllib.parse

OUT = sys.argv[1] if len(sys.argv) > 1 else 'models-extra.js'
MAX_ENTRIES = 6000            # keeps the file around 1 MB
MIN_BYTES = 20 * 1024 * 1024  # skip configs and tiny files
HF_AUTHORS = ['Comfy-Org', 'Kijai', 'city96', 'Lightricks', 'calcuis', 'QuantStack']   # repos that ship ComfyUI-ready files
HF_TAG_LIMIT = 150            # plus the most downloaded repos tagged "comfyui"
HF_REPOS_PER_AUTHOR = 80
CIVITAI_TYPES = ['Checkpoint', 'LORA', 'Controlnet', 'Upscaler', 'VAE', 'TextualInversion']
CIVITAI_PAGES_PER_TYPE = 4    # 100 models per page, most downloaded first
CIVITAI_SITE = 'https://civitai.red'
EXT = re.compile(r'\.(safetensors|sft|ckpt|pt|pth|bin|gguf|onnx)$', re.I)
GENERIC = re.compile(r'^(model|pytorch_model|diffusion_pytorch_model|pytorch_lora_weights|adapter_model|model_fp16|model\.fp16|openvino_model|tf_model|flax_model|optimizer|scheduler|training_args)([-_.].*)?\.[a-z]+$', re.I)
DIRS = {'vae': 'vae', 'vae_approx': 'vae_approx', 'text_encoders': 'text_encoders', 'text_encoder': 'text_encoders', 'clip': 'text_encoders',
        'loras': 'loras', 'lora': 'loras', 'diffusion_models': 'diffusion_models', 'unet': 'diffusion_models', 'checkpoints': 'checkpoints',
        'upscale_models': 'upscale_models', 'latent_upscale_models': 'latent_upscale_models', 'frame_interpolation': 'frame_interpolation',
        'clip_vision': 'clip_vision', 'controlnet': 'controlnet', 'embeddings': 'embeddings', 'model_patches': 'model_patches', 'audio_encoders': 'audio_encoders'}
CIV_DIR = {'Checkpoint': 'checkpoints', 'LORA': 'loras', 'LoCon': 'loras', 'DoRA': 'loras', 'Controlnet': 'controlnet', 'Upscaler': 'upscale_models',
           'VAE': 'vae', 'TextualInversion': 'embeddings'}

def get(url, tries=3):
    """Returns (parsed json, response headers) or (None, {}) after retries."""
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'noodlecheck-catalogue/1.0', 'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode('utf-8')), dict(r.headers)
        except Exception as e:
            print('  retry', i + 1, url[:110], type(e).__name__, str(e)[:80])
            time.sleep(3 * (i + 1))
    return None, {}

def human(n):
    n = float(n)
    return '%.2f GB' % (n / 1024 ** 3) if n >= 1024 ** 3 else '%.0f MB' % (n / 1024 ** 2)

models, skipped_dupes = {}, 0
def add(name, url, folder, base, size_bytes, page):
    global skipped_dupes
    name = name.split('/')[-1]
    if not EXT.search(name) or GENERIC.match(name) or not url or size_bytes < MIN_BYTES or len(models) >= MAX_ENTRIES:
        return
    if name in models:            # first seen wins (sources are visited most-downloaded first)
        skipped_dupes += 1
        return
    models[name] = [url, folder or '', base or '', human(size_bytes), page or '']

def hf_repo(repo_id):
    url = 'https://huggingface.co/api/models/%s/tree/main?recursive=true' % repo_id
    pages = 0
    while url and pages < 6:
        data, headers = get(url)
        if not isinstance(data, list):
            return
        for f in data:
            if f.get('type') != 'file':
                continue
            path = f.get('path', '')
            size = (f.get('lfs') or {}).get('size') or f.get('size') or 0
            folder = next((DIRS[p] for p in reversed(path.split('/')[:-1]) if p in DIRS), '')
            add(path, 'https://huggingface.co/%s/resolve/main/%s' % (repo_id, urllib.parse.quote(path)), folder, '', size, 'https://huggingface.co/' + repo_id)
        m = re.search(r'<([^>]+)>;\s*rel="next"', headers.get('Link', '') or headers.get('link', ''))
        url, pages = (m.group(1) if m else None), pages + 1

def crawl_hf():
    seen = []
    for a in HF_AUTHORS:
        data, _ = get('https://huggingface.co/api/models?author=%s&sort=downloads&direction=-1&limit=%d' % (a, HF_REPOS_PER_AUTHOR))
        seen += [m.get('id') or m.get('modelId') for m in (data or [])]
    data, _ = get('https://huggingface.co/api/models?filter=comfyui&sort=downloads&direction=-1&limit=%d' % HF_TAG_LIMIT)
    seen += [m.get('id') or m.get('modelId') for m in (data or [])]
    done = set()
    for rid in seen:
        if rid and rid not in done:
            done.add(rid)
            hf_repo(rid)
    print('hugging face: %d repos, %d files so far' % (len(done), len(models)))

def crawl_civitai():
    before = len(models)
    for t in CIVITAI_TYPES:
        url = 'https://civitai.com/api/v1/models?limit=100&sort=Most%20Downloaded&period=AllTime&types=' + t
        for _ in range(CIVITAI_PAGES_PER_TYPE):
            data, _h = get(url)
            if not isinstance(data, dict):
                break
            for m in data.get('items') or []:
                for v in m.get('modelVersions') or []:
                    for f in v.get('files') or []:
                        if f.get('type') not in (None, 'Model', 'Pruned Model', 'VAE'):
                            continue
                        dl = (f.get('downloadUrl') or '').replace('https://civitai.com', CIVITAI_SITE)
                        add(f.get('name') or '', dl, CIV_DIR.get(m.get('type'), ''), v.get('baseModel') or '', (f.get('sizeKB') or 0) * 1024,
                            '%s/models/%s?modelVersionId=%s' % (CIVITAI_SITE, m.get('id'), v.get('id')))
            url = (data.get('metadata') or {}).get('nextPage')
            if not url:
                break
    print('civitai: %d files' % (len(models) - before))

crawl_hf()
crawl_civitai()
print('total', len(models), 'duplicates skipped', skipped_dupes)
if len(models) < 50:
    print('Too few results, keeping the existing file.')
    sys.exit(1)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')
js = ('// models-extra.js - written by tools/crawl_models.py on %s (UTC). Do not edit by hand; use community-models.js instead.\n' % stamp
      + 'window.NOODLE_MODELS_EXTRA=' + json.dumps(models, separators=(',', ':'), ensure_ascii=True) + ';\n'
      + 'window.NOODLE_MODELS_EXTRA_INFO=' + json.dumps({'built': stamp, 'count': len(models)}) + ';\n')
open(OUT, 'w', encoding='utf-8').write(js)
print('wrote', OUT, len(js), 'bytes')
