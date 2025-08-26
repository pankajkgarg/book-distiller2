// Pure helpers to build Gemini request payloads without SDK dependency
// Shapes align with @google/genai Content schema

function filePartFromUploaded(uploadedFile){
  const uri = uploadedFile?.uri || uploadedFile?.fileUri || uploadedFile?.file_uri;
  const mimeType = uploadedFile?.mimeType || uploadedFile?.mime_type;
  if(!uri) throw new Error('uploadedFile.uri missing');
  const fd = { fileUri: uri };
  if(mimeType) fd.mimeType = mimeType;
  return { fileData: fd };
}

function userContent(parts){
  const norm = (parts||[]).map(p=> typeof p==='string' ? { text: p } : p);
  return { role: 'user', parts: norm };
}

function addGenConfigIfNeeded(req, { useTemperature, temperature }){
  if(useTemperature){
    req.generationConfig = { temperature: Number(temperature)||0 };
  }
  return req;
}

export function buildFirstRequest({ model, uploadedFile, prompt, useTemperature=false, temperature=0, firstInstruction }){
  const filePart = filePartFromUploaded(uploadedFile);
  const instruction = firstInstruction || 'Begin as instructed.';
  const user = userContent([ filePart, instruction ]);
  const req = { model, contents: [user], tools: [], systemInstruction: prompt };
  addGenConfigIfNeeded(req, { useTemperature, temperature });
  // Add snake_case duplicates for compatibility with different client versions
  req.system_instruction = req.systemInstruction;
  if(req.generationConfig){ req.generation_config = req.generationConfig; }
  return req;
}

export function buildNextRequest({ model, history, uploadedFile, prompt, useTemperature=false, temperature=0, reattachFileEachTurn=false }){
  const parts = [];
  if(reattachFileEachTurn){ parts.push(filePartFromUploaded(uploadedFile)); }
  parts.push('Next');
  const nextUser = userContent(parts);
  const contents = [...(history||[]), nextUser];
  const req = { model, contents, tools: [], systemInstruction: prompt };
  addGenConfigIfNeeded(req, { useTemperature, temperature });
  req.system_instruction = req.systemInstruction;
  if(req.generationConfig){ req.generation_config = req.generationConfig; }
  return req;
}

export function makeUserContent(parts){ return userContent(parts); }
export function makeFilePart(uploadedFile){ return filePartFromUploaded(uploadedFile); }
