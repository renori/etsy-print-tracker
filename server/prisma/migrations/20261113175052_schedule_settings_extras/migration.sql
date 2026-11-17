-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ScheduleSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "morningStart" TEXT NOT NULL DEFAULT '07:30',
    "morningWindowMinutes" INTEGER NOT NULL DEFAULT 15,
    "homeTime" TEXT NOT NULL DEFAULT '18:00',
    "lastStart" TEXT NOT NULL DEFAULT '00:30',
    "changeoverMinutes" INTEGER NOT NULL DEFAULT 5,
    "homeOnWeekends" BOOLEAN NOT NULL DEFAULT true,
    "weekendStart" TEXT NOT NULL DEFAULT '09:00',
    "postOfficeDays" TEXT NOT NULL DEFAULT 'Mon, Wed, Fri',
    "postOfficeTime" TEXT NOT NULL DEFAULT '12:00',
    "shipWithinDays" INTEGER NOT NULL DEFAULT 3
);
INSERT INTO "new_ScheduleSettings" ("homeTime", "id", "lastStart", "morningStart", "morningWindowMinutes") SELECT "homeTime", "id", "lastStart", "morningStart", "morningWindowMinutes" FROM "ScheduleSettings";
DROP TABLE "ScheduleSettings";
ALTER TABLE "new_ScheduleSettings" RENAME TO "ScheduleSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
