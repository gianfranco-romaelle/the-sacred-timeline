import type { CalculusStage, EditorialStageProfile, QuantumStage } from "./types";

export const editorialStages: CalculusStage[] = [0, 1, 2, 3, 4, 5, 6];

// Kept as a compatibility lens for existing UI controls. The historical
// ontology now treats quantum stages as aligned with the seven Calculi.
export const quantumStages: QuantumStage[] = [0, 1, 2, 3, 4, 5, 6];

export const editorialStageFrameworkSeed: EditorialStageProfile[] = [
  {
    id: "stage_zeroth",
    label: "Zeroth",
    shortLabel: "0",
    calculusStage: 0,
    quantumStage: 0,
    window: { kind: "pre-1600-continuum" },
    legacyAliases: ["zero", "zeroth", "stage zero"],
    epochLabel: "Antiquity-Late Renaissance",
    epochDescription:
      "Antiquity through the late Renaissance: sacred geometry, ritual astronomy, Euclidean synthesis, temple grammars, scholastic logic, archaic cosmologies, Renaissance recovery, and esoteric mathematical traditions.",
    structuralThemes: ["Sacred Geometry", "Ritual Astronomy", "Euclidean Geometry"],
    characteristicForms: ["Temple Geometry", "Scholastic Synthesis", "Renaissance Recovery"],
    mentalModes: ["Analogical Reasoning", "Cosmological Ordering", "Ritual Synthesis"],
    ontologicalFocus: ["Cosmos", "Form", "Sacred Order"],
    chemicalEpochs: ["Alchemy", "Hermetic Natural Philosophy"],
    drugEpochs: ["Entheogenic Ritual", "Alchemy", "Monastic Medicine"],
    summary:
      "Antiquity through late Renaissance conceptual regimes organized around sacred geometry, ritual astronomy, Euclidean synthesis, scholastic logic, archaic cosmologies, Renaissance recovery, and esoteric mathematical traditions.",
  },
  {
    id: "stage_first",
    label: "First",
    shortLabel: "I",
    calculusStage: 1,
    quantumStage: 1,
    dateRange: [1600, 1750],
    window: { kind: "bounded", startYear: 1600, endYear: 1750 },
    legacyAliases: ["first", "stage one"],
    epochLabel: "1600-1750",
    epochDescription:
      "Scientific Revolution through early Enlightenment: fluxions, mechanism, Newton, Leibniz, Taylor, Gregory, academies, rationalism, empiricism, and Royal Society traditions.",
    structuralThemes: ["Mechanics", "Fluxions", "Scientific Revolution"],
    characteristicForms: ["Mathematical Treatise", "Experimental Report", "Academy Proceeding"],
    mentalModes: ["Rationalism", "Empiricism", "Mechanical Explanation"],
    ontologicalFocus: ["Mechanism", "Law", "Method"],
    chemicalEpochs: ["Chymistry", "Early Experimental Chemistry"],
    drugEpochs: ["Apothecary Medicine", "Iatrochemistry", "Colonial Materia Medica"],
    summary:
      "The 1600-1750 regime of fluxions, mechanism, Scientific Revolution institutions, Newton-Leibniz calculus, academies, rationalism, empiricism, and Royal Society traditions.",
  },
  {
    id: "stage_second",
    label: "Second",
    shortLabel: "II",
    calculusStage: 2,
    quantumStage: 2,
    dateRange: [1750, 1850],
    window: { kind: "bounded", startYear: 1750, endYear: 1850 },
    legacyAliases: ["second", "stage two"],
    epochLabel: "1750-1850",
    epochDescription:
      "Euler, Lagrange, Laplace, Fourier, PDEs, variational methods, thermodynamics, energy concept, Romantic Naturphilosophie, chemistry, and positivism.",
    structuralThemes: ["Analysis", "Variational Methods", "Energy Concept"],
    characteristicForms: ["PDE System", "Variational Principle", "Chemical System"],
    mentalModes: ["Analytic Synthesis", "Energetic Explanation", "Positivist Classification"],
    ontologicalFocus: ["Energy", "Function", "System"],
    chemicalEpochs: ["Stoichiometry", "Thermochemistry", "Organic Chemistry"],
    drugEpochs: ["Isolation of Alkaloids", "Industrial Pharmacy", "Anesthesia"],
    summary:
      "The 1750-1850 regime of Euler-Lagrange-Laplace-Fourier analysis, PDEs, variational methods, thermodynamics, chemistry, energy concepts, Romantic Naturphilosophie, and positivism.",
  },
  {
    id: "stage_third",
    label: "Third",
    shortLabel: "III",
    calculusStage: 3,
    quantumStage: 3,
    dateRange: [1850, 1900],
    window: { kind: "bounded", startYear: 1850, endYear: 1900 },
    legacyAliases: ["third", "stage three"],
    epochLabel: "1850-1900",
    epochDescription:
      "Riemannian structure, Maxwellian fields, projective geometry, group-theoretic geometry, field theory, relational locality, and early algebraic geometry.",
    structuralThemes: ["Riemannian Geometry", "Field Theory", "Projective Geometry"],
    characteristicForms: ["Manifold", "Field Equation", "Transformation Group"],
    mentalModes: ["Structural Reading", "Relational Locality", "Geometric Abstraction"],
    ontologicalFocus: ["Field", "Relation", "Structure"],
    chemicalEpochs: ["Physical Chemistry", "Electromagnetism", "Thermodynamics"],
    drugEpochs: ["Bacteriology", "Synthetic Dyes", "Early Psychopharmacology"],
    summary:
      "The 1850-1900 regime of Riemannian structure, Maxwellian fields, projective and group-theoretic geometry, field theory, relational locality, and early algebraic geometry.",
  },
  {
    id: "stage_fourth",
    label: "Fourth",
    shortLabel: "IV",
    calculusStage: 4,
    quantumStage: 4,
    dateRange: [1900, 1950],
    window: { kind: "bounded", startYear: 1900, endYear: 1950 },
    legacyAliases: ["fourth", "stage four", "fourth a", "4a", "fourth b", "4b"],
    epochLabel: "1900-1950",
    epochDescription:
      "Symmetry, topology, representation theory, Hilbert and Banach spaces, functional analysis, quantum foundations, structural abstraction, and the Scottish Book, Gottingen, Lwow, and Moscow school period.",
    structuralThemes: ["Symmetry", "Topology", "Functional Analysis"],
    characteristicForms: ["Hilbert Space", "Banach Space", "Representation"],
    mentalModes: ["Structural Abstraction", "Axiomatic Formalization", "Foundational Analysis"],
    ontologicalFocus: ["Space", "Symmetry", "Structure"],
    chemicalEpochs: ["Quantum Chemistry", "Biochemistry", "Radiochemistry"],
    drugEpochs: ["Antibiotics", "Endocrinology", "Psychoanalysis and Psychiatry"],
    summary:
      "The 1900-1950 regime of symmetry, topology, representation theory, Hilbert and Banach spaces, functional analysis, quantum foundations, structural abstraction, and major mathematical schools including the Scottish Book period.",
  },
  {
    id: "stage_fifth",
    label: "Fifth",
    shortLabel: "V",
    calculusStage: 5,
    quantumStage: 5,
    window: { kind: "open-ended", startYear: 1950 },
    legacyAliases: ["fifth", "stage five"],
    epochLabel: "1950-Present",
    epochDescription:
      "Cold War science, military-industrial research, operations research, optimization, control systems, high-energy physics, applied PDE, institutionalized applied mathematics, aerospace, signal processing, and large-scale state scientific infrastructure.",
    structuralThemes: ["Operations Research", "Control Systems", "Large-Scale State Science"],
    characteristicForms: ["Optimization Program", "Signal System", "State Research Laboratory"],
    mentalModes: ["Operational Planning", "Systems Control", "Institutionalized Application"],
    ontologicalFocus: ["Control", "Optimization", "Infrastructure"],
    chemicalEpochs: ["Molecular Biology", "Polymer Chemistry", "Nuclear Chemistry"],
    drugEpochs: ["Antipsychotics", "Psychedelic Research", "Cold War Psychopharmacology"],
    summary:
      "The 1950-present regime of Cold War science, operations research, optimization, control systems, high-energy physics, applied PDE, aerospace, signal processing, and large-scale state scientific infrastructure.",
  },
  {
    id: "stage_sixth",
    label: "Sixth",
    shortLabel: "VI",
    calculusStage: 6,
    quantumStage: 6,
    window: { kind: "open-ended", startYear: 1980 },
    legacyAliases: ["sixth", "stage six"],
    epochLabel: "1980-Present",
    epochDescription:
      "Category theory, topos theory, sheaf theory, stacks, distributed systems, semantic computation, AI, machine learning, cybernetics, information geometry, networks, platform infrastructures, databases, computational ontology, and self-modeling information systems.",
    structuralThemes: ["Semantic Computation", "Distributed Systems", "Computational Ontology"],
    characteristicForms: ["Category", "Topos", "Platform Infrastructure"],
    mentalModes: ["Self-Modeling", "Networked Inference", "Categorical Abstraction"],
    ontologicalFocus: ["Information", "Network", "Ontology"],
    chemicalEpochs: ["Computational Chemistry", "Bioinformatics", "Systems Biology"],
    drugEpochs: ["Genomics Research", "Neuropharmacology", "Platform Biomedicine"],
    summary:
      "The 1980-present regime of category theory, topos theory, sheaves, stacks, distributed systems, semantic computation, AI, machine learning, information geometry, networks, databases, computational ontology, and self-modeling information systems.",
  },
];
