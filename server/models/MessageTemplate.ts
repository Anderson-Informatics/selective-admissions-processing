import mongoose, { Schema } from 'mongoose'

export interface MessageTemplate {
  name: string
  description?: string
  subject: string
  bodyHtml: string
  createdBy?: string
  updatedBy?: string
  createdAt?: Date
  updatedAt?: Date
}

const messageTemplateSchema = new Schema<MessageTemplate>({
  name: { type: String, required: true, unique: true },
  description: String,
  subject: { type: String, required: true, default: '' },
  bodyHtml: { type: String, required: true, default: '' },
  createdBy: String,
  updatedBy: String
}, { timestamps: true })

export const MessageTemplateModel: mongoose.Model<MessageTemplate> = (mongoose.models.MessageTemplate as mongoose.Model<MessageTemplate>) || mongoose.model<MessageTemplate>('MessageTemplate', messageTemplateSchema)
