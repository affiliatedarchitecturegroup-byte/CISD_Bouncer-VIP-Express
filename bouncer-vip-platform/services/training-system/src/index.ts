import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Training types
interface TrainingCourse {
  id: string;
  name: string;
  description: string;
  duration_hours: number;
  required_for: string[];
  modules: any[];
}

const courses: Map<string, TrainingCourse> = new Map();

// Add course
router.post("/courses", async (req: Request, res: Response) => {
  const course: TrainingCourse = {
    id: uuidv4(),
    name: req.body.name,
    description: req.body.description,
    duration_hours: req.body.duration_hours,
    required_for: req.body.required_for || [],
    modules: []
  };
  courses.set(course.id, course);
  res.json(course);
});

// Get courses
router.get("/courses", async (req: Request, res: Response) => {
  res.json({ courses: Array.from(courses.values()) });
});

// Enroll employee
router.post("/enroll", async (req: Request, res: Response) => {
  res.json({
    enrollment_id: uuidv4(),
    employee_id: req.body.employee_id,
    course_id: req.body.course_id,
    status: "enrolled",
    progress: 0
  });
});

// Get progress
router.get("/progress/:employee_id", async (req: Request, res: Response) => {
  res.json({
    employee_id: req.params.employee_id,
    completed_courses: 3,
    in_progress: 1,
    certifications: ["Security", "First Aid", "Bartending"]
  });
});

export default router;