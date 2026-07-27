import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

async function main() {
  const json = readFileSync(new URL('../layouts-index.json', import.meta.url).pathname, 'utf8')
  const blob = new Blob([json], { type: 'application/json' })
  console.log(`Payload size: ${(blob.size / 1024).toFixed(1)} KB`)

  let uploadErr: unknown = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { error } = await supabase.storage
      .from('pattern-catalog')
      .upload('layouts.json', blob, { upsert: true, contentType: 'application/json' })
    if (!error) { uploadErr = null; break }
    uploadErr = error
    console.warn(`Upload attempt ${attempt} failed: ${(error as Error).message ?? error}`)
    if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt))
  }
  if (uploadErr) throw uploadErr
  console.log('Uploaded layouts.json to Storage bucket pattern-catalog.')
}
main().catch(e => { console.error('upload-layouts-index failed:', e); process.exit(1) })
