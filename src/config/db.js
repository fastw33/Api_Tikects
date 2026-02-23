// db.js (ESM)
import mongoose from 'mongoose'

function buildMongoUri() {
  const { MONGODB_URI, DB_HOST, DB_PORT, DB_USER, DB_PASS } = process.env

  if (MONGODB_URI) return MONGODB_URI

  if (DB_USER && DB_PASS) {
    return `mongodb://${DB_USER}:${encodeURIComponent(
      DB_PASS
    )}@${DB_HOST}:${DB_PORT}/${DB_NAME}?authSource=admin`
  }

  return `mongodb://${DB_HOST}:${DB_PORT}/${DB_NAME}`
}

export async function connectDB() {
  const uri = buildMongoUri()

  mongoose.set('strictQuery', true)
  mongoose.connection.on('connected', () =>
    console.log(`✅ MongoDB conectado (db ${dbName})`)
  )
  mongoose.connection.on('error', err =>
    console.error('❌ Error MongoDB:', err.message)
  )
  mongoose.connection.on('disconnected', () =>
    console.log('⚠️  MongoDB desconectado')
  )
  const dbName = process.env.DB_NAME || process.env.MONGODB_DB_NAME
  await mongoose.connect(uri, dbName ? { dbName } : undefined)
}
