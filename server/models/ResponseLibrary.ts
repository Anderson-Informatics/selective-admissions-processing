import mongoose, { Schema } from 'mongoose'

export interface ResponseLibraryEntry {
  match: string
  text: string
}

export interface ResponseLibrary {
  name: string
  key: string
  description?: string
  entries: ResponseLibraryEntry[]
  createdBy?: string
  updatedBy?: string
  createdAt?: Date
  updatedAt?: Date
}

const responseLibrarySchema = new Schema<ResponseLibrary>({
  name: { type: String, required: true, unique: true },
  key: { type: String, required: true, unique: true },
  description: String,
  entries: [{
    match: { type: String, required: true },
    text: { type: String, required: true, default: '' }
  }],
  createdBy: String,
  updatedBy: String
}, { timestamps: true })

export const ResponseLibraryModel: mongoose.Model<ResponseLibrary> = (mongoose.models.ResponseLibrary as mongoose.Model<ResponseLibrary>) || mongoose.model<ResponseLibrary>('ResponseLibrary', responseLibrarySchema)
