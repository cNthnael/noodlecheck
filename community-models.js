// community-models.js v1.0 - 2026-11-12 09:00 WIB
// Hand-maintained list of community models that the automatic catalogue misses.
// Add one entry per model FILE. The key is the exact file name a workflow would use.
//   url  : direct download link (optional if page is given)
//   page : model page on Hugging Face or Civitai
//   size : shown as written, e.g. "19.5 GB"
//   type : ComfyUI models folder (checkpoints, diffusion_models, loras, vae, text_encoders, ...)
//   base : model family, e.g. "MiniMax H3"
// Example (remove the two slashes to enable an entry):
//   "my_model_v1_fp8.safetensors": { url: "https://huggingface.co/someone/repo/resolve/main/my_model_v1_fp8.safetensors", page: "https://huggingface.co/someone/repo", size: "11.9 GB", type: "diffusion_models", base: "FLUX.2" },
window.NOODLE_COMMUNITY = {
};
