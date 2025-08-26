// Normalize GenerateContent request args for the @google/genai SDK
// - Ensures `config.systemInstruction` and `config.temperature` are set per SDK docs
// - Accepts legacy top-level/system_instruction and generationConfig inputs
// - Ensures tools defaults to [] and preserves `config`

export function normalizeGenerateContentArgs(args){
  const src = args || {};
  const out = { ...src };

  // Start from provided config (SDK expects this)
  const cfg = { ...(src.config||{}) };

  // Normalize systemInstruction: prefer src.config, else top-level camel/snake
  const sysFromTop = src.systemInstruction ?? src.system_instruction;
  if(cfg.systemInstruction == null && sysFromTop != null){ cfg.systemInstruction = sysFromTop; }

  // Normalize temperature: accept generationConfig.temperature or top-level generation_config
  const genCfg = src.generationConfig ?? src.generation_config;
  const tempFromGen = genCfg?.temperature;
  if(cfg.temperature == null && (tempFromGen != null)){
    const t = Number(tempFromGen);
    if(Number.isFinite(t)) cfg.temperature = t;
  }

  // Write back normalized config for SDK
  out.config = cfg;

  // Also mirror for compatibility (not required by SDK)
  out.systemInstruction = cfg.systemInstruction ?? out.systemInstruction;
  out.system_instruction = out.systemInstruction;
  if(cfg.temperature != null){
    out.generationConfig = { ...(out.generationConfig||{}), temperature: cfg.temperature };
    out.generation_config = out.generationConfig;
  }

  // Ensure tools is present
  if(!Array.isArray(out.tools)) out.tools = [];

  return out;
}
