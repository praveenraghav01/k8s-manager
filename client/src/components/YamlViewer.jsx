import React, { useState, useEffect } from 'react';
import axios from 'axios';
import hljs from 'highlight.js';
import 'highlight.js/styles/atom-one-dark.css';
import Loader from './Loader';

export default function YamlViewer({ resource, namespace, resourceType }) {
  const [yaml, setYaml] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (resource) {
      fetchYaml();
    }
  }, [resource, namespace, resourceType]);

  const fetchYaml = async () => {
    setLoading(true);
    try {
      // Use the actual namespace from the resource, not the selected namespace
      const resourceNamespace = resource.namespace || namespace;
      const response = await axios.get(
        `/api/yaml/${resourceNamespace}/${resourceType}/${resource.name}`
      );
      setYaml(response.data.yaml || 'No YAML available');
      setError(null);
    } catch (err) {
      setError('Failed to load YAML');
      setYaml('');
    } finally {
      setLoading(false);
    }
  };

  const getHighlightedYaml = () => {
    if (!yaml) return '';
    try {
      return hljs.highlight(yaml, { language: 'yaml' }).value;
    } catch (err) {
      return yaml;
    }
  };

  if (!resource) return null;

  return (
    <div className="yaml-viewer">
      <div className="yaml-header">
        <h3>Configuration: {resource.name}</h3>
        <span className="yaml-close">✕</span>
      </div>
      <div className="yaml-content">
        {loading ? (
          <Loader label="Loading YAML…" inline />
        ) : error ? (
          <div className="yaml-error">{error}</div>
        ) : (
          <pre className="yaml-code">
            <code
              className="hljs language-yaml"
              dangerouslySetInnerHTML={{ __html: getHighlightedYaml() }}
            />
          </pre>
        )}
      </div>
    </div>
  );
}
