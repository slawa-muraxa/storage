import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

// Define the SObject schema
@Schema()
export class SObject extends Document {
  // Unique identifier for the SObject, can be used for querying
  @Prop({ required: true, unique: true })
  id: string;

  // The bucket name where the SObject is stored (e.g., MinIO bucket name)
  @Prop({ required: true })
  bucket: string;

  // The name of the SObject (e.g., file name or object name)
  @Prop({ required: true })
  name: string;

  // The name of the SObject (e.g., file name or object name)
  @Prop({ required: true })
  etag: string;

  // The name of the SObject (e.g., file name or object name)
  @Prop({ required: true })
  size: number;

  // The name of the SObject (e.g., file name or object name)
  @Prop({ required: true })
  lastModified: Date;

  // Whether the SObject is active or not, useful for flagging deleted or archived objects
  @Prop({ default: true })
  active: boolean;

  // Metadata associated with the object, can store video metadata or other attributes
  @Prop({ type: Object, required: false })
  metadata: any;
}

// Create the schema for SObject using SchemaFactory
export const SObjectSchema = SchemaFactory.createForClass(SObject);
