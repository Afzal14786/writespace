import { z } from "zod";

/**
 * @file update-profile.dto.ts
 * @description Validation schema for the "Update Profile" API endpoint.
 * Uses Zod to ensure the request body conforms to expected formats before it reaches the controller.
 */

export const UpdateProfileSchema = z.object({
  body: z.object({
    /** Optional updates to personal information */
    personal_info: z
      .object({
        /** Must be at least 3 characters long */
        fullname: z
          .string()
          .min(3, "Full name must be at least 3 characters")
          .optional(),
        /** Limited to 200 characters */
        bio: z.string().max(200, "Bio cannot exceed 200 characters").optional(),
      })
      .optional(),
    /** Optional updates to social media links. All fields must be valid URLs. */
    social_links: z
      .object({
        twitter: z.string().url("Invalid Twitter URL").optional(),
        github: z.string().url("Invalid GitHub URL").optional(),
        website: z.string().url("Invalid Website URL").optional(),
      })
      .optional(),
  }),
});

/**
 * TypeScript type inferred from the Zod schema.
 * Use this type in the Service layer to ensure type safety for the `updateData` parameter.
 */
export type UpdateProfileDto = z.infer<typeof UpdateProfileSchema>["body"];
