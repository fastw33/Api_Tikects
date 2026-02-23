import fs from 'fs'
import path from 'path'

const RETENTION_DAYS = Number(process.env.CHAT_UPLOAD_RETENTION_DAYS || 90)

function getCutoffMs() {
  return Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
}

async function walk(dir, cutoff) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      await walk(fullPath, cutoff)
      try {
        const left = await fs.promises.readdir(fullPath)
        if (left.length === 0) await fs.promises.rmdir(fullPath)
      } catch {}
      continue
    }

    if (!entry.isFile()) continue

    try {
      const stat = await fs.promises.stat(fullPath)
      if ((stat.mtimeMs || 0) < cutoff) {
        await fs.promises.unlink(fullPath)
      }
    } catch {}
  }
}

export default async function cleanupChatUploads() {
  const root = path.resolve(process.cwd(), 'uploads', 'chats')
  const cutoff = getCutoffMs()

  try {
    await fs.promises.stat(root)
  } catch {
    return { ok: true, deleted: 0 }
  }

  await walk(root, cutoff)
  return { ok: true }
}

if (process.argv.includes('--run')) {
  cleanupChatUploads()
    .then(r => {
      console.log(JSON.stringify(r))
      process.exit(0)
    })
    .catch(err => {
      console.error(err)
      process.exit(1)
    })
}
