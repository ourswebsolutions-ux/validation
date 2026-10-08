import { z } from "zod";
export const singleCheckSchema = z.object({
  number: z.string().trim().min(1, "Number is required").max(40, "Number is too long"),
});

export function bulkCheckSchema(maxNumbers: number) {
  return z.object({
    numbers: z
      .array(z.string().trim().min(1).max(40))
      .min(1, "At least one number is required")
      .max(maxNumbers, `At most ${maxNumbers} numbers per request`),
  });
}

export const jobActionSchema = z.object({
  action: z.enum(["pause", "resume", "stop"]),
});

export const cursorSchema = z.coerce.number().int().min(0).max(1_000_000).default(0);

export const jobIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{10,40}$/, "Invalid job id");
