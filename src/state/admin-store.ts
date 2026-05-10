import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PersonId } from "@/types";
import type { EntityEditorialAssignmentOverride } from "@/editorial/types";
import type {
  CanonicalEntityOverride,
  CanonicalVisibility,
  FieldPrecedence,
  MergeDirective,
  MergeDirectiveId,
  ReviewStatus,
  SourceRecordId,
} from "@/historical/types";
import type { CanonicalFieldKey } from "@/historical/types";

export interface AdminStoreState {
  isAdminMode: boolean;
  showDraftEntities: boolean;
  reviewQueueFilter: "all" | "needs_review" | "manually_overridden" | "unreviewed";
  overridesByEntityId: Partial<Record<PersonId, CanonicalEntityOverride>>;
  editorialAssignmentsByEntityId: Partial<Record<string, EntityEditorialAssignmentOverride>>;
  mergeDirectives: MergeDirective[];
  setAdminMode: (isAdminMode: boolean) => void;
  toggleAdminMode: () => void;
  setShowDraftEntities: (showDraftEntities: boolean) => void;
  setReviewQueueFilter: (
    reviewQueueFilter: "all" | "needs_review" | "manually_overridden" | "unreviewed",
  ) => void;
  updateOverride: (
    entityId: PersonId,
    patch: Partial<Omit<CanonicalEntityOverride, "entityId" | "updatedAt">>,
  ) => void;
  updateEditorialAssignment: (
    entityId: string,
    patch: Partial<Omit<EntityEditorialAssignmentOverride, "entityId" | "updatedAt">>,
  ) => void;
  clearEditorialAssignment: (entityId: string) => void;
  clearOverride: (entityId: PersonId) => void;
  setFieldPrecedence: (
    entityId: PersonId,
    field: CanonicalFieldKey,
    precedence: FieldPrecedence,
  ) => void;
  setReviewStatus: (entityId: PersonId, reviewStatus: ReviewStatus) => void;
  setVisibility: (entityId: PersonId, visibility: CanonicalVisibility) => void;
  addAlias: (entityId: PersonId) => void;
  updateAlias: (entityId: PersonId, index: number, value: string) => void;
  removeAlias: (entityId: PersonId, index: number) => void;
  stageMergeDirective: (directive: Omit<MergeDirective, "id" | "createdAt" | "status">) => void;
  removeMergeDirective: (directiveId: MergeDirectiveId) => void;
  stageUnmergeSourceRecord: (entityId: PersonId, sourceRecordId: SourceRecordId) => void;
}

const getNextDirectiveId = () =>
  `directive_${Math.random().toString(36).slice(2, 10)}` as MergeDirectiveId;

const withExistingOverride = (
  entityId: PersonId,
  existing: CanonicalEntityOverride | undefined,
): CanonicalEntityOverride => ({
  entityId,
  updatedAt: new Date().toISOString(),
  ...existing,
});

const withExistingEditorialAssignment = (
  entityId: string,
  existing: EntityEditorialAssignmentOverride | undefined,
): EntityEditorialAssignmentOverride => ({
  entityId,
  updatedAt: new Date().toISOString(),
  ...existing,
});

export const useAdminStore = create<AdminStoreState>()(
  persist(
    (set) => ({
      isAdminMode: false,
      showDraftEntities: true,
      reviewQueueFilter: "all",
      overridesByEntityId: {},
      editorialAssignmentsByEntityId: {},
      mergeDirectives: [],
      setAdminMode: (isAdminMode) => set({ isAdminMode }),
      toggleAdminMode: () =>
        set((state) => ({
          isAdminMode: !state.isAdminMode,
        })),
      setShowDraftEntities: (showDraftEntities) => set({ showDraftEntities }),
      setReviewQueueFilter: (reviewQueueFilter) => set({ reviewQueueFilter }),
      updateOverride: (entityId, patch) =>
        set((state) => {
          const current = withExistingOverride(entityId, state.overridesByEntityId[entityId]);
          return {
            overridesByEntityId: {
              ...state.overridesByEntityId,
              [entityId]: {
                ...current,
                ...patch,
                updatedAt: new Date().toISOString(),
              },
            },
          };
        }),
      updateEditorialAssignment: (entityId, patch) =>
        set((state) => {
          const current = withExistingEditorialAssignment(
            entityId,
            state.editorialAssignmentsByEntityId[entityId],
          );
          return {
            editorialAssignmentsByEntityId: {
              ...state.editorialAssignmentsByEntityId,
              [entityId]: {
                ...current,
                ...patch,
                updatedAt: new Date().toISOString(),
              },
            },
          };
        }),
      clearEditorialAssignment: (entityId) =>
        set((state) => {
          const nextAssignments = { ...state.editorialAssignmentsByEntityId };
          delete nextAssignments[entityId];
          return {
            editorialAssignmentsByEntityId: nextAssignments,
          };
        }),
      clearOverride: (entityId) =>
        set((state) => {
          const nextOverrides = { ...state.overridesByEntityId };
          delete nextOverrides[entityId];
          return {
            overridesByEntityId: nextOverrides,
          };
        }),
      setFieldPrecedence: (entityId, field, precedence) =>
        set((state) => {
          const current = withExistingOverride(entityId, state.overridesByEntityId[entityId]);
          return {
            overridesByEntityId: {
              ...state.overridesByEntityId,
              [entityId]: {
                ...current,
                fieldPrecedence: {
                  ...current.fieldPrecedence,
                  [field]: precedence,
                },
                updatedAt: new Date().toISOString(),
              },
            },
          };
        }),
      setReviewStatus: (entityId, reviewStatus) =>
        set((state) => {
          const current = withExistingOverride(entityId, state.overridesByEntityId[entityId]);
          return {
            overridesByEntityId: {
              ...state.overridesByEntityId,
              [entityId]: {
                ...current,
                reviewStatus,
                updatedAt: new Date().toISOString(),
              },
            },
          };
        }),
      setVisibility: (entityId, visibility) =>
        set((state) => {
          const current = withExistingOverride(entityId, state.overridesByEntityId[entityId]);
          return {
            overridesByEntityId: {
              ...state.overridesByEntityId,
              [entityId]: {
                ...current,
                visibility,
                updatedAt: new Date().toISOString(),
              },
            },
          };
        }),
      addAlias: (entityId) =>
        set((state) => {
          const current = withExistingOverride(entityId, state.overridesByEntityId[entityId]);
          return {
            overridesByEntityId: {
              ...state.overridesByEntityId,
              [entityId]: {
                ...current,
                aliases: [...(current.aliases ?? []), ""],
                updatedAt: new Date().toISOString(),
              },
            },
          };
        }),
      updateAlias: (entityId, index, value) =>
        set((state) => {
          const current = withExistingOverride(entityId, state.overridesByEntityId[entityId]);
          const aliases = [...(current.aliases ?? [])];
          aliases[index] = value;
          return {
            overridesByEntityId: {
              ...state.overridesByEntityId,
              [entityId]: {
                ...current,
                aliases,
                updatedAt: new Date().toISOString(),
              },
            },
          };
        }),
      removeAlias: (entityId, index) =>
        set((state) => {
          const current = withExistingOverride(entityId, state.overridesByEntityId[entityId]);
          return {
            overridesByEntityId: {
              ...state.overridesByEntityId,
              [entityId]: {
                ...current,
                aliases: (current.aliases ?? []).filter((_, currentIndex) => currentIndex !== index),
                updatedAt: new Date().toISOString(),
              },
            },
          };
        }),
      stageMergeDirective: (directive) =>
        set((state) => ({
          mergeDirectives: [
            {
              ...directive,
              // TODO: apply staged directives in a persisted reconciliation worker or API.
              id: getNextDirectiveId(),
              createdAt: new Date().toISOString(),
              status: "staged",
            },
            ...state.mergeDirectives,
          ],
        })),
      removeMergeDirective: (directiveId) =>
        set((state) => ({
          mergeDirectives: state.mergeDirectives.filter((directive) => directive.id !== directiveId),
        })),
      stageUnmergeSourceRecord: (entityId, sourceRecordId) =>
        set((state) => {
          const current = withExistingOverride(entityId, state.overridesByEntityId[entityId]);
          const sourceExclusions = Array.from(
            new Set([...(current.sourceExclusions ?? []), sourceRecordId]),
          );

          return {
            overridesByEntityId: {
              ...state.overridesByEntityId,
              [entityId]: {
                ...current,
                sourceExclusions,
                updatedAt: new Date().toISOString(),
              },
            },
          };
        }),
    }),
    {
      name: "sacred-timeline-admin-store",
      partialize: (state) => ({
        isAdminMode: state.isAdminMode,
        showDraftEntities: state.showDraftEntities,
        reviewQueueFilter: state.reviewQueueFilter,
        overridesByEntityId: state.overridesByEntityId,
        editorialAssignmentsByEntityId: state.editorialAssignmentsByEntityId,
        mergeDirectives: state.mergeDirectives,
      }),
    },
  ),
);
