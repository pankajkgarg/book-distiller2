// Normalize GenerateContent request args for the @google/genai SDK
// - Lifts config.systemInstruction / generationConfig to top-level
// - Duplicates snake_case fields for compatibility
// - Ensures tools defaults to []

export function normalizeGenerateContentArgs(args){
  const src = args || {};
  const out = { ...src };

  // Lift legacy config fields
  const cfg = src.config || {};
  if(out.systemInstruction == null && cfg.systemInstruction != null){
    out.systemInstruction = cfg.systemInstruction;
  }
  if(out.generationConfig == null && cfg.generationConfig != null){
    out.generationConfig = cfg.generationConfig;
  }

  // Allow snake_case inputs too
  if(out.systemInstruction == null && src.system_instruction != null){
    out.systemInstruction = src.system_instruction;
  }
  if(out.generationConfig == null && src.generation_config != null){
    out.generationConfig = src.generation_config;
  }

  // Duplicate for compatibility
  out.system_instruction = out.systemInstruction;
  if(out.generationConfig) out.generation_config = out.generationConfig;

  // Remove config to avoid confusion in downstream client
  delete out.config;

  // Ensure tools is present
  if(!Array.isArray(out.tools)) out.tools = [];

  return out;
}

