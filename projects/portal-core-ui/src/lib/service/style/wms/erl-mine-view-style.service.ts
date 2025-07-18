import { Injectable } from '@angular/core';
import { StyleService } from './style.service';
import { serialize } from '@thi.ng/hiccup';

interface ErlMineViewStyleParams {
  optionalFilters?: any[];
  gsmlpNamespace: string;
}

@Injectable()
export class ErlMineViewStyleService {
  constructor(private styleService: StyleService) {}

  public static getSld(layerName: string, styleName: string, params: ErlMineViewStyleParams): string {
    const ns = {
      sld: 'http://www.opengis.net/sld',
      ogc: 'http://www.opengis.net/ogc',
      gml: 'http://www.opengis.net/gml',
      erl: 'http://xmlns.earthresourceml.org/earthresourceml-lite/2.0',
      gsmlp: 'urn:cgi:xmlns:CGI:GeoSciML:2.0',
      xsi: 'http://www.w3.org/2001/XMLSchema-instance'
    };

    const filter = this.generateFilter(params.optionalFilters || []);
    
    return serialize(
      ['sld:StyledLayerDescriptor', { 
        version: '1.0.0',
        'xmlns:sld': ns.sld,
        'xmlns:ogc': ns.ogc,
        'xmlns:gml': ns.gml,
        'xmlns:erl': ns.erl,
        'xmlns:gsmlp': ns.gsmlp,
        'xmlns:xsi': ns.xsi,
        'xsi:schemaLocation': [
          `${ns.sld} http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd`,
          `${ns.erl} http://schemas.earthresourceml.org/earthresourceml-lite/2.0/earthresourceml-lite.xsd`
        ].join(' ')
      },
        ['sld:NamedLayer', {},
          ['sld:Name', {}, layerName],
          ['sld:UserStyle', {},
            ['sld:Name', {}, styleName],
            ['sld:Title', {}, 'ERL Mine View Style'],
            ['sld:FeatureTypeStyle', {},
              ['sld:Rule', {},
                filter,
                this.createSymbolizer('#a51f2f', 'circle', ns)
              ]
            ]
          ]
        ]
      ]
    );
  }

  /**
   * Generate filter based on optional filters
   * @param optionalFilters Array of optional filters
   * @returns Filter XML structure or null if no filters
   */
  private static generateFilter(optionalFilters: any[]): any {
    // Parse optional filters if they're a string
    let parsedFilters: any[] = [];
    try {
      if (optionalFilters && typeof optionalFilters === 'string') {
        parsedFilters = JSON.parse(optionalFilters);
      } else if (Array.isArray(optionalFilters)) {
        parsedFilters = optionalFilters;
      }
    } catch (e) {
      console.error('Failed to parse optional filters', e);
    }

    // Build filter fragments
    const filterFragments: any[] = [];

    if (parsedFilters && parsedFilters.length > 0) {
      for (const filter of parsedFilters) {
        // Skip disabled filters
        if (filter.enabled !== undefined && !filter.enabled) {
          continue;
        }

        let propertyFilter: any = null;

        // Handle filter types explicitly
        if (filter.type) {
          switch (filter.type) {
            case 'OPTIONAL.TEXT':
              propertyFilter = this.handleTextFilter(filter);
              break;
            case 'OPTIONAL.DROPDOWNREMOTE':
              propertyFilter = this.handleDropdownFilter(filter);
              break;
            case 'OPTIONAL.POLYGONBBOX':
              propertyFilter = this.handlePolygonFilter(filter);
              break;
            case 'OPTIONAL.PROVIDER':
              continue;
            default:
              if (filter.xpath && filter.value) {
                propertyFilter = this.generatePropertyFilter(filter.xpath, filter.value, filter.predicate || 'ISEQUAL');
              }
              break;
          }
        }
        // Handle different filter formats for backward compatibility
        else if (Array.isArray(filter)) {
          if (filter.length >= 4) {
            const [label, field, _, operator] = filter;
            
            const arrayFilter = filter as unknown as { value?: string };
            if (field && arrayFilter.value) {
              propertyFilter = this.generatePropertyFilter(field, arrayFilter.value, operator || 'ISEQUAL');
            }
          }
        }
        // Handle standard object format without explicit type
        else if (typeof filter === 'object') {
          // Handle filters with xpath and value
          if (filter.label && filter.value && filter.xpath) {
            let operator = filter.predicate || 'ISEQUAL';
            propertyFilter = this.generatePropertyFilter(filter.xpath, filter.value, operator);
          }
          // Standard filter with field and value
          else if (filter.field && filter.value) {
            propertyFilter = this.generatePropertyFilter(
              filter.field,
              filter.value,
              filter.operator || 'ISEQUAL'
            );
          }
        }

        if (propertyFilter) {
          filterFragments.push(propertyFilter);
        }
      }
    }

    // Combine filters
    if (filterFragments.length > 0) {
      const result = filterFragments.length === 1
        ? ['ogc:Filter', {}, filterFragments[0]]
        : ['ogc:Filter', {}, ['ogc:And', {}, ...filterFragments]];
      
      // Log the final filter for debugging
      console.log('ERL Mine View Style - Generated filter for:',
        parsedFilters.map(f => `${f.label}: ${f.value}`).join(', '));
      return result;
    }

    return null;
  }

  /**
   * Handle text filter
   * @param filter Filter object
   * @returns Property filter structure
   */
  private static handleTextFilter(filter: any): any {
    if (!filter.xpath || !filter.value) {
      return null;
    }
    
    if (filter.predicate === 'ISLIKE') {
      return ['ogc:PropertyIsLike', { wildCard: '*', singleChar: '#', escapeChar: '!', matchCase: 'false' },
        ['ogc:PropertyName', {}, filter.xpath],
        ['ogc:Literal', {}, `*${filter.value}*`]
      ];
    } else if (filter.predicate === 'ISEQUAL') {
      return ['ogc:PropertyIsEqualTo', { matchCase: 'false' },
        ['ogc:PropertyName', {}, filter.xpath],
        ['ogc:Literal', {}, filter.value]
      ];
    }
    
    return null;
  }

  /**
   * Handle dropdown filter
   * @param filter Filter object
   * @returns Property filter structure
   */
  private static handleDropdownFilter(filter: any): any {
    if (!filter.xpath || !filter.value) {
      return null;
    }
    
    if (filter.predicate === 'ISEQUAL') {
      return ['ogc:PropertyIsEqualTo', { matchCase: 'false' },
        ['ogc:PropertyName', {}, filter.xpath],
        ['ogc:Literal', {}, filter.value]
      ];
    }
    
    return null;
  }

  /**
   * Handle polygon/bbox filter
   * @param filter Filter object
   * @returns Property filter structure
   */
  private static handlePolygonFilter(filter: any): any {
    if (!filter.xpath || !filter.value) {
      return null;
    }
    
    if (filter.predicate === 'ISEQUAL') {
      return ['ogc:Intersects', {},
        ['ogc:PropertyName', {}, filter.xpath],
        filter.value 
      ];
    }
    
    return null;
  }

  /**
   * Generate property filter
   * @param field Field name
   * @param value Field value
   * @param operator Operator to use
   * @returns Property filter structure
   */
  private static generatePropertyFilter(field: string, value: string, operator: string): any {
    if (!field || value === undefined || value === null) return null;

    const operatorUpper = (operator || 'ISEQUAL').toUpperCase();

    switch (operatorUpper) {
      case 'ISEQUAL':
      case '=':
        return ['ogc:PropertyIsEqualTo', { matchCase: 'false' },
          ['ogc:PropertyName', {}, field],
          ['ogc:Literal', {}, value]
        ];
      case 'ISNOTEQUAL':
      case '!=':
        return ['ogc:PropertyIsNotEqualTo', { matchCase: 'false' },
          ['ogc:PropertyName', {}, field],
          ['ogc:Literal', {}, value]
        ];
      case 'BIGGER_THAN':
      case '>':
        return ['ogc:PropertyIsGreaterThan', {},
          ['ogc:PropertyName', {}, field],
          ['ogc:Literal', {}, value]
        ];
      case 'SMALLER_THAN':
      case '<':
        return ['ogc:PropertyIsLessThan', {},
          ['ogc:PropertyName', {}, field],
          ['ogc:Literal', {}, value]
        ];
      case 'ISLIKE':
      case 'LIKE':
        // Use * wildcards for GeoServer compatibility  
        const formattedValue = value.includes('*') ? value : `*${value}*`;
        return ['ogc:PropertyIsLike', { wildCard: '*', singleChar: '#', escapeChar: '!', matchCase: 'false' },
          ['ogc:PropertyName', {}, field],
          ['ogc:Literal', {}, formattedValue]
        ];
      default:
        return ['ogc:PropertyIsEqualTo', { matchCase: 'false' },
          ['ogc:PropertyName', {}, field],
          ['ogc:Literal', {}, value]
        ];
    }
  }

  private static createSymbolizer(color: string, mark: string, ns: any): any[] {
    return ['sld:PointSymbolizer', {},
      ['sld:Graphic', {},
        ['sld:Mark', {},
          ['sld:WellKnownName', {}, mark],
          ['sld:Fill', {},
            ['sld:CssParameter', { name: 'fill' }, color],
            ['sld:CssParameter', { name: 'fill-opacity' }, '0.4']
          ],
          ['sld:Stroke', {},
            ['sld:CssParameter', { name: 'stroke' }, color],
            ['sld:CssParameter', { name: 'stroke-width' }, '1']
          ]
        ],
        ['sld:Size', {}, '8']
      ]
    ];
  }
} 