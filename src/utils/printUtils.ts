export function printDocument(target: string): void {
  if (typeof window === 'undefined' || typeof window.print !== 'function') {
    throw new Error('Printing is not available in this browser.');
  }

  const documents = Array.from(document.querySelectorAll<HTMLElement>('[data-print-document]'));
  const selected = documents.filter(node => node.dataset.printDocument === target);
  if (!selected.length) throw new Error('The requested document preview is unavailable.');
  // Multiple previews can be mounted together; only the requested document may print.
  const previousSelection = documents.map(node => [node, node.getAttribute('data-print-selected')] as const);
  documents.forEach(node => {
    if (selected.some(active => active === node || active.contains(node) || node.contains(active))) {
      node.dataset.printSelected = 'true';
    } else {
      node.dataset.printSelected = 'false';
    }
  });
  const previousTarget = document.body.dataset.printTarget;
  const restoreTarget = () => {
    previousSelection.forEach(([node, value]) => {
      if (value === null) delete node.dataset.printSelected;
      else node.setAttribute('data-print-selected', value);
    });
    if (previousTarget) {
      document.body.dataset.printTarget = previousTarget;
    } else {
      delete document.body.dataset.printTarget;
    }
  };

  document.body.dataset.printTarget = target;
  window.addEventListener('afterprint', restoreTarget, { once: true });

  try {
    window.print();
  } catch (error) {
    window.removeEventListener('afterprint', restoreTarget);
    restoreTarget();
    throw error;
  }
}
