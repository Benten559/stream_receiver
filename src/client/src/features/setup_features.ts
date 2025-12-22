/**
 * Feature toggle UI - creates and manages feature toggle buttons
 */

import type { Feature } from '../types/streaming.types.js';
import type { FeatureManager } from './feature_manager.js';

/**
 * Create feature toggle buttons in the UI
 * @param featureManager - The feature manager instance
 */
export function setupFeatureToggles(featureManager: FeatureManager): void {
  const container = document.getElementById('feature-options');

  if (!container) {
    console.error('feature-options container not found');
    return;
  }

  // Clear existing content
  container.innerHTML = '';

  // Get all features
  const features = featureManager.getAllFeatures();

  if (features.length === 0) {
    console.log('No features available');
    return;
  }

  // Create toggle button for each feature
  features.forEach(feature => {
    const button = createFeatureButton(feature, featureManager);
    container.appendChild(button);
  });
}

/**
 * Create a toggle button for a feature
 */
function createFeatureButton(feature: Feature, featureManager: FeatureManager): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = `feature-button ${feature.enabled ? 'enabled' : 'disabled'}`;
  button.dataset.featureId = feature.id;
  button.textContent = feature.name;
  button.title = feature.description;

  // Handle click to toggle feature
  button.addEventListener('click', () => {
    const newState = !feature.enabled;
    featureManager.toggleFeature(feature.id, newState);

    // Update button appearance
    if (newState) {
      button.classList.remove('disabled');
      button.classList.add('enabled');
    } else {
      button.classList.remove('enabled');
      button.classList.add('disabled');
    }
  });

  return button;
}
