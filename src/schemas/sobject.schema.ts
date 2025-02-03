import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Schema as MongooseSchema } from "mongoose";

// Define enum before usage
export enum ServiceName {
  CVAT = "CVAT",
  STORAGE_PREVIEW = "STORAGE_PREVIEW",
  STORAGE_VERSION = "STORAGE_VERSION",
  STORAGE_LAKE = "STORAGE_LAKE",
}

export function mapServiceName(value: string): ServiceName | undefined {
  return Object.values(ServiceName).find((s) => s === value);
}
// Link subdocument schema
@Schema()
export class Link {
  @Prop({ type: String, enum: Object.values(ServiceName), required: true })
  serviceName: ServiceName;

  @Prop({ required: true })
  trackingId: string;

  @Prop({ type: MongooseSchema.Types.Mixed, required: false })
  references: any;
}

// Target schema factory
export const LinkSchema = SchemaFactory.createForClass(Link);

// Define SObject schema
@Schema()
export class SObject extends Document {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  bucket: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: false })
  etag: string;

  @Prop({ required: false })
  size: number;

  @Prop({ required: true, default: new Date() })
  created: Date;

  @Prop({ required: false })
  lastModified: Date;

  @Prop({ default: false })
  preview: boolean;

  @Prop({ required: false })
  activeVersion: string;

  @Prop({ type: Object, required: false })
  metadata: any;

  @Prop({ default: true })
  original: boolean;

  @Prop({ type: [LinkSchema], default: [] })
  targets: Link[];

  @Prop({ type: [LinkSchema], default: [] })
  sources: Link[];

  @Prop({ default: true })
  active: boolean;
}

// Create the schema for SObject
export const SObjectSchema = SchemaFactory.createForClass(SObject);