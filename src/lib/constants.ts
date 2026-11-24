export const CONCEPTS = [
  {
    id: 1,
    subject: "Pythagoras' theorem",
    text: "In a right-angled triangle, the longest side is called the hypotenuse. The square of the hypotenuse is equal to the sum of the squares of the other two sides: a2 + b2 = c2.",
  },
  {
    id: 2,
    subject: "Parts of a circle",
    text: "A circle has a centre. The radius is the distance from the centre to the edge. The diameter goes across the circle through the centre and is twice the radius. The circumference is the distance around the circle.",
  },
  {
    id: 3,
    subject: "Series circuit",
    text: "In a series circuit there is only one loop. The current is the same everywhere in the loop. The voltage of the cell is shared between the components.",
  },
  {
    id: 4,
    subject: "Photosynthesis",
    text: "Plants take in carbon dioxide and water. They use light energy, absorbed by chlorophyll, to make glucose and oxygen.",
  },
  {
    id: 5,
    subject: "States of matter",
    text: "In a solid the particles are close together and vibrate in place. In a liquid they are close but move past each other. In a gas they are far apart and move fast.",
  },
];

export type Concept = typeof CONCEPTS[number];

export interface ValidationResult {
  valid: boolean;
  checks: {
    isParsable: boolean;
    withinViewBox: boolean;
    hasTitleAndLabels: boolean;
    hasAnimation: boolean;
    noScripts: boolean; // My custom check
  };
  error?: string;
}

export interface GenerationResult {
  conceptId: number;
  subject: string;
  svg: string;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  retries: number;
  validation: ValidationResult;
  status: "approved" | "rejected" | "pending";
}
