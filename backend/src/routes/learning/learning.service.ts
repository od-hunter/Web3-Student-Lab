import prisma from '../../db/index.js';
import { getCurriculumForCourse } from './curriculum.data.js';
import { CurriculumCourse, Module, Progress, ProgressStatus, ProgressUpdateInput } from './types.js';

const toProgress = (progress: {
  id: string;
  studentId: string;
  courseId: string;
  completedLessons: string[];
  currentModuleId: string | null;
  percentage: number;
  status: string;
  lastAccessedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Progress => ({
  ...progress,
  status: progress.status as ProgressStatus,
});

const filterModulesByDifficulty = (modules: Module[], difficulty?: string): Module[] => {
  if (!difficulty) {
    return modules;
  }

  return modules
    .map((module) => ({
      ...module,
      lessons: module.lessons.filter((lesson) => lesson.difficulty === difficulty),
    }))
    .filter((module) => module.lessons.length > 0);
};

const countLessons = (modules: Module[]): number => {
  return modules.reduce((total, module) => total + module.lessons.length, 0);
};

const buildCourseStatus = (completedLessonCount: number, totalLessons: number): ProgressStatus => {
  if (completedLessonCount === 0) {
    return 'not_started';
  }

  if (totalLessons > 0 && completedLessonCount >= totalLessons) {
    return 'completed';
  }

  return 'in_progress';
};

const buildPercentage = (
  completedLessonCount: number,
  totalLessons: number,
  explicitPercentage?: number,
): number => {
  if (typeof explicitPercentage === 'number') {
    return explicitPercentage;
  }

  if (totalLessons === 0) {
    return 0;
  }

  return Math.round((completedLessonCount / totalLessons) * 100);
};

export const listCourses = async (difficulty?: string): Promise<CurriculumCourse[]> => {
  const courses = await prisma.course.findMany({
    orderBy: { createdAt: 'asc' },
  });

  return courses.map((course) => ({
    ...course,
    modules: filterModulesByDifficulty(getCurriculumForCourse(course.id), difficulty),
  }));
};

export const getCourseCurriculum = async (
  courseId: string,
  difficulty?: string,
): Promise<CurriculumCourse | null> => {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
  });

  if (!course) {
    return null;
  }

  return {
    ...course,
    modules: filterModulesByDifficulty(getCurriculumForCourse(course.id), difficulty),
  };
};

export const getStudentProgress = async (
  studentId: string,
  courseId: string,
): Promise<Progress | null> => {
  const progress = await prisma.learningProgress.findUnique({
    where: {
      studentId_courseId: {
        studentId,
        courseId,
      },
    },
  });

  return progress ? toProgress(progress) : null;
};

export const updateStudentProgress = async (
  studentId: string,
  courseId: string,
  input: ProgressUpdateInput,
): Promise<Progress> => {
  const modules = getCurriculumForCourse(courseId);
  const lesson = modules.flatMap((module) => module.lessons).find((entry) => entry.id === input.lessonId);

  if (!lesson) {
    throw new Error('LESSON_NOT_FOUND');
  }

  const moduleForLesson = modules.find((module) =>
    module.lessons.some((entry) => entry.id === input.lessonId),
  );
  const totalLessons = countLessons(modules);
  const existingProgress = await getStudentProgress(studentId, courseId);

  const completedLessonSet = new Set(existingProgress?.completedLessons ?? []);

  if (input.status === 'completed') {
    completedLessonSet.add(input.lessonId);
  } else {
    completedLessonSet.delete(input.lessonId);
  }

  const completedLessons = Array.from(completedLessonSet);
  const percentage = buildPercentage(completedLessons.length, totalLessons, input.percentage);
  const status = buildCourseStatus(completedLessons.length, totalLessons);
  const completedAt = status === 'completed' ? new Date() : null;

  const progress = await prisma.learningProgress.upsert({
    where: {
      studentId_courseId: {
        studentId,
        courseId,
      },
    },
    update: {
      completedLessons,
      currentModuleId: moduleForLesson?.id ?? existingProgress?.currentModuleId ?? null,
      percentage,
      status,
      lastAccessedAt: new Date(),
      completedAt,
    },
    create: {
      studentId,
      courseId,
      completedLessons,
      currentModuleId: moduleForLesson?.id ?? null,
      percentage,
      status,
      lastAccessedAt: new Date(),
      completedAt,
    },
  });

  return toProgress(progress);
};
