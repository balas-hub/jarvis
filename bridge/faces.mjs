/**
 * JARVIS Facial Database & Biometric Person Recognition System.
 *
 * Persists enrolled people in `data/faces.json` and photo references in `data/faces/`.
 * Uses Gemini multimodal vision to extract biometric visual descriptors during enrollment
 * and to identify people captured by the camera.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')
const DATA_DIR = path.join(PROJECT_ROOT, 'data')
const FACES_DIR = path.join(DATA_DIR, 'faces')
const DB_FILE = path.join(DATA_DIR, 'faces.json')

function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
  if (!fs.existsSync(FACES_DIR)) {
    fs.mkdirSync(FACES_DIR, { recursive: true })
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ people: [] }, null, 2), 'utf-8')
  }
}

export function readDatabase() {
  ensureStorage()
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed?.people) ? parsed.people : []
  } catch (err) {
    console.warn('[faces] Error reading facial database:', err.message)
    return []
  }
}

export function writeDatabase(people) {
  ensureStorage()
  fs.writeFileSync(DB_FILE, JSON.stringify({ people, lastUpdated: new Date().toISOString() }, null, 2), 'utf-8')
}

export function listPeople() {
  return readDatabase()
}

/**
 * Enrolls a person into the facial database.
 * Analyzes the face photo using Gemini to produce a robust visual descriptor.
 */
export async function enrollPerson({ name, notes = '', imageBase64, mimeType = 'image/jpeg', ai, model }) {
  ensureStorage()
  const people = readDatabase()

  const id = `person_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const photoFilename = `${id}.jpg`
  const photoPath = path.join(FACES_DIR, photoFilename)

  if (imageBase64) {
    const cleanBase64 = imageBase64.includes(',') ? imageBase64.slice(imageBase64.indexOf(',') + 1) : imageBase64
    fs.writeFileSync(photoPath, Buffer.from(cleanBase64, 'base64'))
  }

  let features = 'Person enrolled via camera capture.'
  if (ai && model && imageBase64) {
    try {
      const cleanBase64 = imageBase64.includes(',') ? imageBase64.slice(imageBase64.indexOf(',') + 1) : imageBase64
      const resp = await ai.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text:
                  'Analyze the face in this image for biometric facial identification purposes. ' +
                  'Describe key identifying facial features in 2-3 concise sentences: face shape, hair type/color/length, ' +
                  'glasses (if any), facial hair, distinguishing landmarks, skin tone, and prominent characteristics.',
              },
              {
                inlineData: {
                  mimeType,
                  data: cleanBase64,
                },
              },
            ],
          },
        ],
      })
      features = resp?.text ? resp.text.trim() : features
    } catch (err) {
      console.warn('[faces] Feature extraction failed; using fallback:', err.message)
    }
  }

  const existingIdx = people.findIndex((p) => p.name.toLowerCase() === name.toLowerCase())
  const record = {
    id,
    name,
    notes: notes || 'Enrolled user',
    enrolledAt: new Date().toISOString(),
    photoFile: photoFilename,
    features,
  }

  if (existingIdx >= 0) {
    people[existingIdx] = { ...people[existingIdx], ...record, id: people[existingIdx].id }
  } else {
    people.push(record)
  }

  writeDatabase(people)
  return record
}

/**
 * Identifies a person in a captured frame by comparing against enrolled database profiles.
 */
export async function identifyPerson({ imageBase64, mimeType = 'image/jpeg', ai, model }) {
  ensureStorage()
  const people = readDatabase()

  if (!people.length) {
    return {
      matched: false,
      name: null,
      confidence: 0,
      notes: null,
      message: 'Facial database is empty. Please ask JARVIS to enroll someone first.',
    }
  }

  if (!ai || !model || !imageBase64) {
    return {
      matched: false,
      name: null,
      confidence: 0,
      notes: null,
      message: 'Vision model or camera frame not available for recognition.',
    }
  }

  const cleanBase64 = imageBase64.includes(',') ? imageBase64.slice(imageBase64.indexOf(',') + 1) : imageBase64

  const candidateList = people
    .map((p, idx) => `Person #${idx + 1}: Name: "${p.name}", Notes: "${p.notes}", Known Features: "${p.features}"`)
    .join('\n')

  const prompt =
    'You are the biometric facial recognition system for J.A.R.V.I.S.\n' +
    'Examine the person shown in this camera frame, and compare them against the following enrolled profiles in the facial database:\n' +
    candidateList +
    '\n\n' +
    'Determine if the person in the camera image matches any enrolled person. ' +
    'Respond STRICTLY in JSON format with no markdown wrappers:\n' +
    '{\n' +
    '  "matched": boolean,\n' +
    '  "name": string or null,\n' +
    '  "confidence": number between 0.0 and 1.0,\n' +
    '  "notes": string or null,\n' +
    '  "explanation": "concise rationale based on facial features"\n' +
    '}'

  try {
    const resp = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: cleanBase64 } },
          ],
        },
      ],
    })

    const raw = (resp?.text || '').replace(/```json/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(raw)
    return {
      matched: Boolean(parsed.matched),
      name: parsed.name ?? null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      notes: parsed.notes ?? null,
      explanation: parsed.explanation ?? '',
    }
  } catch (err) {
    console.warn('[faces] Identification error:', err.message)
    return {
      matched: false,
      name: null,
      confidence: 0,
      notes: null,
      message: `Identification failed: ${err.message}`,
    }
  }
}

export function renamePerson(identifier, newName) {
  ensureStorage()
  const people = readDatabase()
  const target = people.find(
    (p) => p.id === identifier || p.name.toLowerCase() === identifier.toLowerCase(),
  )
  if (!target) return null
  target.name = newName
  writeDatabase(people)
  return target
}

export function deletePerson(identifier) {
  ensureStorage()
  const people = readDatabase()
  const idx = people.findIndex(
    (p) => p.id === identifier || p.name.toLowerCase() === identifier.toLowerCase(),
  )
  if (idx === -1) return false
  const [removed] = people.splice(idx, 1)
  if (removed.photoFile) {
    try {
      const pPath = path.join(FACES_DIR, removed.photoFile)
      if (fs.existsSync(pPath)) fs.unlinkSync(pPath)
    } catch {}
  }
  writeDatabase(people)
  return true
}
