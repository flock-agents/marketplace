import { defineComponent } from "../../define";
import { Questions } from "./Questions";
import { QuestionsSchema } from "./Questions.schema";
export const QuestionsDef = defineComponent({ ...QuestionsSchema, component: Questions });
