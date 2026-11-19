export type Testimonial = {
  id: string;
  /** 1 to 5 */
  rating: number;
  quote: string;
  name: string;
  /** e.g. "Verified order, Dudley" */
  detail: string;
};

/**
 * Real, approved customer reviews only. The home page hides the whole section while this list is empty,
 * so nothing invented is ever shown. Add entries here (or load them from your review provider) once you have consent.
 */
export const testimonials: Testimonial[] = [];
